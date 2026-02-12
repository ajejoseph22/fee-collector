# Technical Documentation

Companion to [README.md](./README.md). This document covers the architecture, code layout, design decisions, and trade-offs behind the Fee Consolidation Service.

## Table of Contents
- [System Design](#system-design)
- [Code Structure](#code-structure)
- [Sync Engine Internals](#sync-engine-internals)
- [Data Integrity Guarantees](#data-integrity-guarantees)
- [RPC Interaction Patterns](#rpc-interaction-patterns)
- [Multi-Chain Architecture](#multi-chain-architecture)
- [Retry & Failure Strategy](#retry--failure-strategy)
- [Key Design Decisions](#key-design-decisions)
- [Testing](#testing)
- [Open Questions](#open-questions)

---

## System Design

The service has two independent runtime components sharing a MongoDB instance:

**Sync Engine/Worker** — A long-running loop that polls EVM chains for `FeesCollected` contract events, normalizes them, and persists them. It is stateful (tracks sync progress per chain) and must run as a single instance per chain to avoid sync state races.

**REST API** — A stateless Express server that reads indexed events from MongoDB. Horizontally scalable behind a load balancer. A crash in the API has no impact on the worker, and vice versa.

**Why?**
This separation exists because the two components have fundamentally different scaling needs and failure modes. The worker is a singleton loop where concurrent instances would corrupt shared state. The API is stateless reads that benefit from horizontal scaling, thus coupling them means a worker crash takes down the API, and an API deployment could interrupt an in-progress sync cycle. The decoupling also gives the scalability benefit of running one engine per chain, each in different processes (essential for when more than a few chains are supported).

## Code Structure

```
src/
├── index.ts                              # Express app bootstrap
├── server.ts                             # HTTP server entry
│
├── api/                                  # ── REST API  ──
│   ├── fee/
│   │   ├── fee.controller.ts             # request validation, response shaping
│   │   ├── fee.service.ts                # business logic, cursor encoding/decoding
│   │   ├── fee.repository.ts             # MongoDB queries 
│   │   ├── fee.model.ts                  # Zod schemas + OpenAPI type generation
│   │   └── fee.router.ts                 # GET /fees route definition
│   ├── health-check/
│   │   └── health-check.router.ts        # GET /health-check route definition
│   └── api-docs/
│       ├── open-api.document-generator.ts # OpenAPI spec builder
│       └── open-api.router.ts            # Swagger UI route definition
│
├── common/                               # ── Shared infrastructure ──
│   ├── db/mongo.ts                       # Mongo connection helpers
│   ├── middleware/                       # Error handler, rate limiter, request logger
│   └── utils/
│       ├── env.config.ts                 # Shared env vars 
│       └── logger.ts                     # logging utils
│
└── fee-collector/                        # ── Fee collection worker/engine ──
    ├── worker.entry.ts                   # worker entry point 
    ├── worker.ts                         # worker orchestration
    ├── worker.helpers.ts                 # helper functions (CLI parsing, sleep with AbortSignal, etc.)
    ├── client.ts                         # FeeCollectorClient interface + factory
    ├── config/
    │   ├── chains.config.ts              # supported chains registry
    │   └── env.config.ts                 # worker-specific env
    ├── models/
    │   ├── fee-collected-event.ts        # Typegoose model — indexed FeesCollected event
    │   └── chain-sync-state.ts           # Typegoose model — per-chain sync state
    └── services/
        ├── sync.service.ts               # syncing core logic
        └── parsing.service.ts            # pure function to parse raw events into DTOs
```

The two runtime components — API and worker — share `common/` but have zero cross-imports between `api/` and `fee-collector/`. This enforces the architectural boundary at the module level: they can be deployed, scaled, and restarted independently without risk of coupling.

## Sync Engine Internals

The sync engine (`sync.service.ts`) runs a deterministic batch loop per invocation:

```
1. Compute safeBlock (latestBlock - confirmations)    [fixed per cycle]
2. Load sync state from MongoDB                    [resume point]
3. Check for chain reorg (compare stored with blobk hash)        [rollback if needed]
4. Batch loop: from -> safeBlock in batchSize steps
   a. Query events from RPC
   b. Fetch block timestamps for unique blocks
   c. Parse raw events into DTOs
   d. Persist with idempotent upserts
   e. Update sync state checkpoint
5. Return — worker sleeps, then does steps 1-5 again
```

### Safe block calculation
This ensures we only process blocks that are deep enough in the chain to be considered final. The `confirmations` offset is configurable (default: 20 blocks) to balance between near real-time indexing and reorg safety.

### Batch range computation

`computeBatchRange(lastProcessed, safeBlock, batchSize)` returns `{from: lastProcessed + 1, to: min(from + batchSize - 1, safeBlock)}` or `null` when fully caught up. If the safe block is behind `lastProcessedBlock`, the function returns `null` immediately — the sync logs "fully caught up" and returns without making any RPC calls. After the sleep interval (configurable), it repeats the process, so if the chain has advanced, it will compute a new batch range and continue syncing.

### Reorg detection and rollback

Before entering the batch loop, the engine compares the stored block hash for `lastProcessedBlock` against the on-chain hash. If they differ, a chain reorganization has occurred.

Rollback deletes all events after `lastProcessedBlock` - `reorgBacktrack` (configurable, default 200) and resets the sync state. The empty block hash signals to the next cycle that reorg detection should be skipped (there's no hash to compare against). The batch loop then re-syncs from the rollback point.

## Data Integrity Guarantees

### Idempotent writes

Events are persisted using MongoDB `bulkWrite` with `updateOne` + `$setOnInsert` + `upsert: true`. If a document with the same `(chainId, txHash, logIndex)` already exists, the operation is a no-op. If the process crashes after persisting events but before updating the sync state, the next run re-scans the same block range — upserts ensure no duplicates are created.

`ordered: false` ensures all operations in the batch are attempted even if one fails, maximizing throughput and avoiding the loss of an entire batch due to a single problematic document.

### Crash recovery

The sync state checkpoint (`lastProcessedBlock`, `lastProcessedBlockHash`) is updated after each batch is persisted. On crash, the next run resumes from the last checkpoint. The worst case is re-scanning one `batchSize` worth of blocks — events are deduplicated by the upsert logic, so this is safe.

### Event uniqueness

An EVM event is uniquely identified by `(chainId, transactionHash, logIndex)`. `logIndex` is the position of the log entry within the transaction's receipt — a transaction can emit multiple events, and `logIndex` distinguishes them. This triple is used as the compound unique key for the MongoDB collection.

## RPC Interaction Patterns

### StaticJsonRpcProvider over JsonRpcProvider

ethers v5's `JsonRpcProvider` sends an `eth_chainId` request before every RPC call to verify the network hasn't changed. This doubles RPC request volume against rate-limited public endpoints. Worse, when the endpoint is rate-limited, the pre-flight `eth_chainId` fails with `NETWORK_ERROR: could not detect network` before the actual request is even sent — so the retry logic retries an operation that was never attempted.

`StaticJsonRpcProvider` caches the network after first detection. It's the recommended ethers v5 pattern for known-chain connections. The trade-off is that it won't detect a misconfigured RPC URL pointing at the wrong chain. In practice, this is an operational concern mitigated by correct environment configuration. When this happens, the worker logs a meaningful error "Possible RPC misconfiguration" and continues after the interval (in continuous mode) or exits (in once mode)

### Batch size trade-off (default: 10 blocks)

Public & free RPC nodes impose limits on `eth_getLogs` responses — Alchemy's free tier caps at 10 blocks, hence the default. When running paid, more reliable RPCs, one can safely increase to match the RPCs extended limits. Change to be made in `FEE_COLLECTOR_BATCH_SIZE` environment variable.

### Confirmation window (default: 20 blocks)

The most recent blocks on a blockchain are not guaranteed to be final. The network can replace them via a chain reorganization. By subtracting a confirmations offset from the latest block, we only process blocks that have enough subsequent blocks built on top to make a reorg way less likely. On Polygon, 20 blocks (~40 seconds) provides a comfortable margin while keeping the sync near real-time.

## Multi-Chain Architecture

### Two-tier chain validation

The system recognizes chains at two levels:

1. **`Chain` enum** — All known chains (Polygon, Ethereum) - Ethereum was added a POC of extensibility. The CLI parser validates against this. Passing an unknown chain like `--chain solana` throws an error.

2. **`SUPPORTED_CHAINS` registry** — Chains with active RPC and contract configuration (currently Polygon only). The worker filters against this at runtime. Passing `--chain ethereum` logs a warning and skips it — the chain is recognized but not yet configured.

This design lets the codebase demonstrate multi-chain extensibility as a proof of concept without requiring live RPC endpoints and contract addresses for every chain in the enum.

### Adding a new chain

1. Add a value to the `Chain` enum in `chains.config.ts`
2. Add its env vars (`FEE_COLLECTOR_{CHAIN}_RPC`, `FEE_COLLECTOR_{CHAIN}_ADDRESS`, `FEE_COLLECTOR_{CHAIN}_START_BLOCK`, `FEE_COLLECTOR_{CHAIN}_REORG_BACKTRACK`) to `fee-collector/config/env.config.ts`
3. Add an entry to `SUPPORTED_CHAINS` keyed by the enum value

The sync engine, parser, and persistence layer are completely chain-agnostic — they operate on `(client, SyncConfig)` tuples. No chain-specific logic exists outside the configuration layer.

### Per-chain worker scaling

Running one worker per chain is optional but recommended for production. Independent processes provide fault isolation (a Polygon RPC outage doesn't stall Ethereum syncing), independent resource allocation, and independent restarts. The current implementation supports this via `--chain polygon` and `--chain ethereum` flags. Documented in the README [here](./README.md#notes).

Running multiple workers for the same chain is explicitly unsupported — each would overwrite the other's `lastProcessedBlock`, causing redundant re-scanning and wasted RPC calls. Upserts prevent duplicate events, but the overhead is significant. This is a recognized constraint with a clear mitigation path: a per-chain distributed lease lock in MongoDB. The solution design - including `ownerId`, `expiresAt`, heartbeat renewal, and lock-specific test cases - is documented in the [README's Next Steps](./README.md#next-steps).

## Retry & Failure Strategy

### Two-tier retry

**Inner retry** (`withRetry` in sync.service.ts): 3 attempts with exponential backoff (5s, 10s). Handles temporary RPC hiccups — brief network blips, rate limit responses (public RPCs like `polygon-rpc.com` typically respond with "retry in 10s") etc.

**Outer retry** (worker poll loop): If all inner retries are exhausted, the error propagates to the worker. The worker logs the error, waits the full poll interval (configurable), and calls `sync` again. This handles sustained outages without burning through rapid retries.

### Graceful shutdown

`SIGINT`/`SIGTERM` triggers an `AbortController`. The signal is checked between batches in the sync loop and between cycles in the worker loop. The `sleep` helper resolves immediately when the signal fires mid-sleep. MongoDB disconnection always runs as a `finally` step, even when `sync` throws.

## Key Design Decisions

### Pure parsing function

The raw `ethers.Event` object does not contain a block timestamp - only `blockNumber`, `blockHash`, `transactionHash`, `logIndex`, and decoded arguments. Getting a timestamp requires a separate RPC call. Rather than making the parser impure, the sync engine handles the call: it collects unique block numbers from the batch, fetches metadata via `client.getBlock()`, builds a `Map<blockNumber, timestamp>`, and passes it to the parser. The parser is a pure function.

Also, `chainId` is not embedded in event objects (events are chain-agnostic log entries). It's passed as a configuration value, making the same parser work for any EVM chain.

### Block timestamp as write-time enrichment

As a follow up from the previous point, resolving timestamps costs one `getBlock()` RPC call per unique event-bearing block in each batch. It's additional latency on top of what reorg detection and checkpointing already require. The trade-off is paying that cost once at index time so every downstream consumer gets calendar time without making their own RPC calls. Without it, adding time-based filtering later (e.g., "all fees collected in January") would require re-indexing the entire event history. The REST API currently returns `blockTimestamp` in the response but does not yet expose time-based query parameters. The field is stored so that capability can be added without backfilling.

### Number types for block ranges, not BlockTag

The ethers `BlockTag` type accepts `number | string | "latest" | "pending"`. The sync engine always works with resolved, concrete block numbers. Accepting `BlockTag` would allow callers to pass `"latest"`, which is non-deterministic. Using `number` enforces at the type level that the caller must resolve the block number before querying, keeping ranges deterministic and resumable.

### Cursor-based pagination

Offset pagination (`skip` + `limit`) works fine for small datasets, but MongoDB's `skip(N)` physically scans and discards N documents before returning results. At deep pages, this gets expensive. Cursor pagination uses an indexed `_id` query (`{_id: {$gt: lastSeenId}}`) which jumps directly to the right position regardless of page depth — consistently fast whether user is at page 1 or page 1,000.


## Testing
The entire codebase has ~85% test coverage across unit and integration tests. The sync engine has dedicated tests for services, helpers, the client and the worker while the API has tests for controllers, services, and repositories.
Verifiable by running `pnpm run test:cov`:


## Open Questions

### Operational


- **Monitoring and observability**: The service currently logs structured JSON via `pino` but exposes no metrics. Key metrics to surface: blocks scanned per cycle, no of events persisted per block/cycle, lag behind chain head, RPC error rate, sync cycle duration etc. Which of these are worth tracking?

### Data model

- **Event mutability after finalization**: Once a block is finalized and events are stored, can those events ever change outside of a reorg? If so, the upsert strategy may need to be revisited. Current assumption: finalized events are immutable.

- **Contract ABI stability**: How stable is the contract ABI? The service uses `FeeCollector__factory` from a pinned commit of `lifi-contract-types`. If the contract is redeployed with a different `FeesCollected` event signature, `queryFilter` would
  silently get no events. The service may appear healthy while missing all new activity. No multi-ABI-version handling exists.

- **Multiple contracts per chain?**: The current architecture assumes one `FeeCollector` contract address per chain. If multiple contracts exist on the same chain, the config model would need to support an array of addresses per chain entry.

### Use of AI
Lastly, AI was used selectively across this project. However, every line of generated code was human-reviewed by me, refactored where needed, and validated with extensive tests. The architectural decisions, trade-offs and documentation are all my brainchildren.