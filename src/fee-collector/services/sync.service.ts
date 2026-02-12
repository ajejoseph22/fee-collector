import { type Logger, pino } from "pino";

import type { FeeCollectorClient } from "../client";
import { ChainSyncStateModel } from "../models/chain-sync-state";
import { FeeCollectedEventModel } from "../models/fee-collected-event";
import { parseFeeCollectedEvents } from "./parsing.service";

export interface SyncConfig {
	chainId: number;
	startBlock: number;
	confirmations: number;
	batchSize: number;
	reorgBacktrack: number;
	batchDelayMs: number;
}

// ------------------
// Public API
// ------------------

export async function sync(
	client: FeeCollectorClient,
	config: SyncConfig,
	logger?: Logger,
	signal?: AbortSignal,
): Promise<void> {
	const log = (logger ?? pino({ name: "fee-collector-sync" })).child({ chainId: config.chainId });

	// 1. Compute the safe block once for the entire cycle
	const safeBlock = await getLatestSafeBlock(client, config, log);

	// 2. Load sync state
	let state = await loadSyncState(config.chainId, config.startBlock, log);

	// 3. Reorg detection
	if (await detectReorg(client, state, log)) {
		const rollbackTo = await handleReorg(config.chainId, state.lastProcessedBlock, config, log);
		state = { lastProcessedBlock: rollbackTo, lastProcessedBlockHash: null };
	}

	// 4. Batch loop
	let range = computeBatchRange(state.lastProcessedBlock, safeBlock, config.batchSize);
	while (range) {
		const batch = range;

		if (signal?.aborted) {
			log.info({ lastProcessedBlock: state.lastProcessedBlock }, "shutdown requested, stopping sync");
			return;
		}

		log.info({ from: batch.from, to: batch.to }, "processing batch");

		// a. Query events
		const rawEvents = await withRetry(() => client.queryFeesCollected(batch.from, batch.to), "queryFeesCollected", log);

		// b. Parse and persist events if any
		if (rawEvents.length > 0) {
			const blockNumbers = rawEvents.map((e) => e.blockNumber);
			const blockTimestamps = await fetchBlockTimestamps(client, blockNumbers, log);
			const parsedEvents = parseFeeCollectedEvents(rawEvents, config.chainId, blockTimestamps);
			await persistEvents(parsedEvents, log);
		}

		// c. Update sync state with the end block of this batch
		const endBlock = await withRetry(() => client.getBlock(batch.to), "getBlock(endBlock)", log);
		if (!endBlock) {
			throw new Error(`Block ${batch.to} not found on chain — possible RPC misconfiguration`);
		}
		await updateSyncState(config.chainId, batch.to, endBlock.hash, log);

		// d. Advance
		state.lastProcessedBlock = batch.to;
		range = computeBatchRange(state.lastProcessedBlock, safeBlock, config.batchSize);

		// e. Throttle before next batch to avoid rate limits
		if (range) await sleep(config.batchDelayMs);
	}

	log.info({ lastProcessedBlock: state.lastProcessedBlock, safeBlock }, "fully caught up");
}

// -------------------
// Internal helpers
// -------------------
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
	fn: () => Promise<T>,
	label: string,
	log: Logger,
	maxAttempts = 3,
	initialDelayMs = 5000,
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;

			if (attempt < maxAttempts) {
				const delay = initialDelayMs * 2 ** (attempt - 1);
				log.warn({ err, attempt, maxAttempts, delay }, `${label} failed, retrying`);
				await sleep(delay);
			}
		}
	}

	throw lastError;
}

async function getLatestSafeBlock(client: FeeCollectorClient, config: SyncConfig, log: Logger): Promise<number> {
	const latest = await withRetry(() => client.getBlockNumber(), "getBlockNumber", log);
	const safeBlock = latest - config.confirmations;
	log.info({ latest, confirmations: config.confirmations, safeBlock }, "computed safe block");
	return safeBlock;
}

async function loadSyncState(
	chainId: number,
	startBlock: number,
	log: Logger,
): Promise<{ lastProcessedBlock: number; lastProcessedBlockHash: string | null }> {
	const state = await withRetry(() => ChainSyncStateModel.findOne({ chainId }).lean().exec(), "loadSyncState", log);

	if (state) {
		log.info({ lastProcessedBlock: state.lastProcessedBlock }, "loaded existing sync state");

		return {
			lastProcessedBlock: state.lastProcessedBlock,
			lastProcessedBlockHash: state.lastProcessedBlockHash,
		};
	}

	log.info({ startBlock }, "no sync state found, initializing");

	return { lastProcessedBlock: startBlock - 1, lastProcessedBlockHash: null };
}

async function detectReorg(
	client: FeeCollectorClient,
	state: { lastProcessedBlock: number; lastProcessedBlockHash: string | null },
	log: Logger,
): Promise<boolean> {
	if (!state.lastProcessedBlockHash) return false;

	const block = await withRetry(() => client.getBlock(state.lastProcessedBlock), "detectReorg.getBlock", log);

	if (!block) {
		throw new Error(`Block ${state.lastProcessedBlock} not found on chain — possible RPC misconfiguration`);
	}

	if (block.hash !== state.lastProcessedBlockHash) {
		log.warn(
			{
				blockNumber: state.lastProcessedBlock,
				expected: state.lastProcessedBlockHash,
				actual: block.hash,
			},
			"reorg detected — block hash mismatch",
		);
		return true;
	}
	return false;
}

async function handleReorg(
	chainId: number,
	lastProcessedBlock: number,
	config: SyncConfig,
	log: Logger,
): Promise<number> {
	const rollbackTo = Math.max(config.startBlock - 1, lastProcessedBlock - config.reorgBacktrack);
	log.warn({ lastProcessedBlock, rollbackTo, reorgBacktrack: config.reorgBacktrack }, "handling reorg");

	await withRetry(
		() =>
			FeeCollectedEventModel.deleteMany({
				chainId,
				blockNumber: { $gt: rollbackTo },
			}).exec(),
		"handleReorg.deleteEvents",
		log,
	);

	if (rollbackTo < config.startBlock) {
		// Nothing to reference — remove sync state entirely
		await withRetry(() => ChainSyncStateModel.deleteOne({ chainId }).exec(), "handleReorg.deleteSyncState", log);
	} else {
		await withRetry(
			() =>
				ChainSyncStateModel.updateOne(
					{ chainId },
					{ $set: { lastProcessedBlock: rollbackTo, lastProcessedBlockHash: "" } },
				).exec(),
			"handleReorg.resetSyncState",
			log,
		);
	}

	log.info({ rollbackTo }, "reorg rollback complete");
	return rollbackTo;
}

async function fetchBlockTimestamps(
	client: FeeCollectorClient,
	blockNumbers: number[],
	log: Logger,
): Promise<Map<number, number>> {
	const uniqueBlockNumbers = [...new Set(blockNumbers)];
	log.debug({ count: uniqueBlockNumbers.length }, "fetching block timestamps");

	const uniqueBlocks = await Promise.all(
		uniqueBlockNumbers.map((blockNumber) =>
			withRetry(() => client.getBlock(blockNumber), `getBlock(${blockNumber})`, log),
		),
	);

	const map = new Map<number, number>();
	for (const block of uniqueBlocks) {
		if (!block) {
			throw new Error("Block not found on chain — possible RPC misconfiguration");
		}
		map.set(block.number, block.timestamp);
	}
	return map;
}

async function persistEvents(events: ReturnType<typeof parseFeeCollectedEvents>, log: Logger): Promise<void> {
	if (events.length === 0) return;

	const bulkOps = events.map((e) => ({
		updateOne: {
			filter: { chainId: e.chainId, txHash: e.txHash, logIndex: e.logIndex },
			update: { $setOnInsert: e },
			upsert: true,
		},
	}));

	const result = await withRetry(
		() => FeeCollectedEventModel.bulkWrite(bulkOps, { ordered: false }),
		"persistEvents",
		log,
	);
	log.info({ added: result.upsertedCount, skipped: result.matchedCount }, "persisted events");
}

async function updateSyncState(chainId: number, blockNumber: number, blockHash: string, log: Logger): Promise<void> {
	await withRetry(
		() =>
			ChainSyncStateModel.updateOne(
				{ chainId },
				{ $set: { chainId, lastProcessedBlock: blockNumber, lastProcessedBlockHash: blockHash } },
				{ upsert: true },
			).exec(),
		"updateSyncState",
		log,
	);
	log.debug({ blockNumber, blockHash }, "sync state updated");
}

function computeBatchRange(
	fromBlock: number,
	safeBlock: number,
	batchSize: number,
): { from: number; to: number } | null {
	const from = fromBlock + 1;
	if (from > safeBlock) return null;
	const to = Math.min(from + batchSize - 1, safeBlock);
	return { from, to };
}
