import type { Logger } from "pino";
import { expect } from "vitest";
import { type SyncConfig, sync } from "@/fee-collector/services/sync.service";

const mocks = vi.hoisted(() => ({
	chainStateFindOne: vi.fn(),
	chainStateUpdateOne: vi.fn(),
	chainDeleteOne: vi.fn(),
	feeEventDeleteMany: vi.fn(),
	feeEventBulkWrite: vi.fn(),
	parseFeeCollectedEvents: vi.fn(),
}));

vi.mock("@/fee-collector/models/chain-sync-state", () => ({
	ChainSyncStateModel: {
		findOne: mocks.chainStateFindOne,
		updateOne: mocks.chainStateUpdateOne,
		deleteOne: mocks.chainDeleteOne,
	},
}));

vi.mock("@/fee-collector/models/fee-collected-event", () => ({
	FeeCollectedEventModel: {
		deleteMany: mocks.feeEventDeleteMany,
		bulkWrite: mocks.feeEventBulkWrite,
	},
}));

vi.mock("@/fee-collector/services/parsing.service", () => ({
	parseFeeCollectedEvents: mocks.parseFeeCollectedEvents,
}));

describe("Sync service", () => {
	const config: SyncConfig = {
		chainId: 137,
		startBlock: 100,
		confirmations: 5,
		batchSize: 10,
		reorgBacktrack: 10,
		batchDelayMs: 0,
	};
	const rawEvent = {
		blockNumber: 100,
		blockHash: "0xblock100",
		transactionHash: "0xtx",
		logIndex: 1,
		data: "0x",
		topics: [],
	};
	const parsedEvents = [
		{
			chainId: 137,
			blockNumber: 100,
			blockHash: "0xblock100",
			txHash: "0xtx",
			logIndex: 1,
			token: "0x1111111111111111111111111111111111111111",
			integrator: "0x2222222222222222222222222222222222222222",
			integratorFee: "10",
			lifiFee: "2",
			blockTimestamp: 1_700_000_000,
		},
	];
	const loggerMocks = { child: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
	const logger = loggerMocks as unknown as Logger;

	// Mimics Mongoose's `.findOne().lean().exec()` chain
	function queryResult<T>(value: T) {
		return {
			lean: () => ({
				exec: async () => value,
			}),
		};
	}

	// Mimics Mongoose's `.updateOne().exec()` / `.deleteOne().exec()` chain
	function execResult<T>(value: T) {
		return {
			exec: async () => value,
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
		loggerMocks.child.mockReturnValue(logger);
		mocks.chainStateUpdateOne.mockReturnValue(execResult({ acknowledged: true }));
		mocks.chainDeleteOne.mockReturnValue(execResult({ acknowledged: true }));
		mocks.feeEventDeleteMany.mockReturnValue(execResult({ acknowledged: true }));
		mocks.feeEventBulkWrite.mockResolvedValue({ upsertedCount: 1, matchedCount: 0 });
	});

	// Happy path: first sync, no existing state, one event found.
	// latest=106, safeBlock=106-5=101, startBlock=100 → batch [100,101]
	it("should process a batch correctly", async () => {
		mocks.chainStateFindOne.mockReturnValue(queryResult(null)); // no previous sync state
		mocks.parseFeeCollectedEvents.mockReturnValue(parsedEvents);

		const client = {
			getBlockNumber: vi.fn().mockResolvedValue(106),
			queryFeesCollected: vi.fn().mockResolvedValue([rawEvent]),
			getBlock: vi.fn().mockImplementation(async (blockNumber: number) => ({
				number: blockNumber,
				hash: `0xblock${blockNumber}`,
				timestamp: 1_700_000_000,
			})),
		};

		await sync(client, config, logger);

		expect(client.queryFeesCollected).toHaveBeenCalledWith(100, 101);
		expect(mocks.parseFeeCollectedEvents).toHaveBeenCalledWith([rawEvent], 137, expect.any(Map));
		const timestampMap = mocks.parseFeeCollectedEvents.mock.calls[0]?.[2] as Map<number, number>;
		expect(timestampMap.get(100)).toBe(1_700_000_000);

		// Persist events with upsert
		expect(mocks.feeEventBulkWrite).toHaveBeenCalledWith(
			[
				{
					updateOne: {
						filter: { chainId: 137, txHash: "0xtx", logIndex: 1 },
						update: { $setOnInsert: parsedEvents[0] },
						upsert: true,
					},
				},
			],
			{ ordered: false },
		);
		// Update sync state to last processed block in batch (101), not latest (106)
		expect(mocks.chainStateUpdateOne).toHaveBeenCalledWith(
			{ chainId: 137 },
			{ $set: { chainId: 137, lastProcessedBlock: 101, lastProcessedBlockHash: "0xblock101" } },
			{ upsert: true },
		);
		expect(mocks.feeEventDeleteMany).not.toHaveBeenCalled(); // no reorg, no deletions
	});

	// Reorg: we synced to block 150 with hash "0xold", but on-chain block 150 now
	// has a different hash (0xblock150) → rollback 10 blocks to 140, delete stale events, re-sync 141–145
	it("should handle reorg by rolling back and continuing from rollback point", async () => {
		mocks.chainStateFindOne.mockReturnValue(queryResult({ lastProcessedBlock: 150, lastProcessedBlockHash: "0xold" }));
		mocks.parseFeeCollectedEvents.mockReturnValue([]);
		const client = {
			getBlockNumber: vi.fn().mockResolvedValue(150), // safeBlock = 150-5 = 145
			queryFeesCollected: vi.fn().mockResolvedValue([]),
			getBlock: vi.fn().mockImplementation(async (blockNumber: number) => ({
				number: blockNumber,
				hash: `0xblock${blockNumber}`, // block 150 returns "0xblock150", not "0xold" -> mismatch
				timestamp: 1_700_000_000,
			})),
		};

		await sync(client, config, logger);

		// Rollback: delete events after block 140 and reset sync state
		expect(mocks.feeEventDeleteMany).toHaveBeenCalledWith({
			chainId: 137,
			blockNumber: { $gt: 140 },
		});
		expect(mocks.chainStateUpdateOne).toHaveBeenNthCalledWith(
			1,
			{ chainId: 137 },
			{ $set: { lastProcessedBlock: 140, lastProcessedBlockHash: "" } },
		);
		// Re-sync from rollback point
		expect(client.queryFeesCollected).toHaveBeenCalledWith(141, 145);
		expect(mocks.chainStateUpdateOne).toHaveBeenNthCalledWith(
			2,
			{ chainId: 137 },
			{ $set: { chainId: 137, lastProcessedBlock: 145, lastProcessedBlockHash: "0xblock145" } },
			{ upsert: true },
		);
		expect(mocks.chainDeleteOne).not.toHaveBeenCalled();
	});

	// No events in the batch — parsing and persistence are skipped,
	// but sync state still advances (the range was processed, just empty)
	it("should skip parsing and persistence when no events are returned", async () => {
		mocks.chainStateFindOne.mockReturnValue(queryResult(null));

		const client = {
			getBlockNumber: vi.fn().mockResolvedValue(106), // safeBlock = 105 - 5 = 101
			queryFeesCollected: vi.fn().mockResolvedValue([]), // no events
			getBlock: vi.fn().mockImplementation(async (blockNumber: number) => ({
				number: blockNumber,
				hash: `0xhash${blockNumber}`,
				timestamp: 1_700_000_000,
			})),
		};

		await sync(client, config, logger);

		expect(client.queryFeesCollected).toHaveBeenCalledWith(100, 101);
		expect(mocks.parseFeeCollectedEvents).not.toHaveBeenCalled();
		expect(mocks.feeEventBulkWrite).not.toHaveBeenCalled();
		expect(mocks.chainStateUpdateOne).toHaveBeenCalledWith(
			{ chainId: 137 },
			{ $set: { chainId: 137, lastProcessedBlock: 101, lastProcessedBlockHash: "0xhash101" } },
			{ upsert: true },
		);
	});

	// batchSize=5, safeBlock=110, startBlock=100 → 3 batches: [100,104], [105,109], [110,110]
	it("should process batches correctly when range exceeds batch size", async () => {
		mocks.chainStateFindOne.mockReturnValue(queryResult(null));
		mocks.parseFeeCollectedEvents.mockReturnValue([]);

		const client = {
			getBlockNumber: vi.fn().mockResolvedValue(115),
			queryFeesCollected: vi.fn().mockResolvedValue([]),
			getBlock: vi.fn().mockImplementation(async (blockNumber: number) => ({
				number: blockNumber,
				hash: `0xhash${blockNumber}`,
				timestamp: 1_700_000_000,
			})),
		};

		await sync(client, { ...config, batchSize: 5 }, logger);

		// Range: 100..110 (safeBlock = 115-5=110), batches: [100,104], [105,109], [110,110]
		expect(client.queryFeesCollected).toHaveBeenCalledTimes(3);
		expect(client.queryFeesCollected).toHaveBeenNthCalledWith(1, 100, 104);
		expect(client.queryFeesCollected).toHaveBeenNthCalledWith(2, 105, 109);
		expect(client.queryFeesCollected).toHaveBeenNthCalledWith(3, 110, 110);
	});

	// withRetry: first getBlockNumber call fails, second succeeds.
	// Fake timers needed because withRetry sleeps 5s between attempts.
	// startBlock=100, latest=106, confirmations=5 → safeBlock=101, so only one batch [100,101] to process.
	it("should retry and succeed when an RPC call fails once", async () => {
		vi.useFakeTimers();

		mocks.chainStateFindOne.mockReturnValue(queryResult(null));
		mocks.parseFeeCollectedEvents.mockReturnValue([]);

		const client = {
			getBlockNumber: vi.fn().mockRejectedValueOnce(new Error("RPC timeout")).mockResolvedValue(106),
			queryFeesCollected: vi.fn().mockResolvedValue([]),
			getBlock: vi.fn().mockImplementation(async (blockNumber: number) => ({
				number: blockNumber,
				hash: `0xhash${blockNumber}`,
				timestamp: 1_700_000_000,
			})),
		};

		const syncPromise = sync(client, config, logger);
		await vi.advanceTimersByTimeAsync(60_000);
		await syncPromise;

		// Called twice due to retry
		expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
		// Eventually succeeds and continues to query events
		expect(client.queryFeesCollected).toHaveBeenCalledWith(100, 101);

		vi.useRealTimers();
	});

	// withRetry: getBlockNumber always fails → 3 attempts then throws.
	// Fake timers needed because withRetry sleeps 5s between attempts.
	// .catch((err) => err) converts rejection to a resolved value so we can assert on it.
	it("should throw and return after exhausting all retry attempts", async () => {
		vi.useFakeTimers();

		mocks.chainStateFindOne.mockReturnValue(queryResult(null));

		const client = {
			getBlockNumber: vi.fn().mockRejectedValue(new Error("RPC permanently down")),
			queryFeesCollected: vi.fn(),
			getBlock: vi.fn(),
		};

		const syncPromise = sync(client, config, logger).catch((err) => err);
		await vi.advanceTimersByTimeAsync(60_000);
		const error = await syncPromise;

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("RPC permanently down");
		expect(client.getBlockNumber).toHaveBeenCalledTimes(3);
		expect(client.queryFeesCollected).not.toHaveBeenCalled();

		vi.useRealTimers();
	});

	it("should throw with a clear message when getBlock returns null (e.g. RPC misconfiguration)", async () => {
		mocks.chainStateFindOne.mockReturnValue(queryResult({ lastProcessedBlock: 150, lastProcessedBlockHash: "0xold" }));

		const client = {
			getBlockNumber: vi.fn().mockResolvedValue(200),
			queryFeesCollected: vi.fn(),
			getBlock: vi.fn().mockResolvedValue(null), // block doesn't exist on this chain
		};

		await expect(sync(client, config, logger)).rejects.toThrow("not found on chain — possible RPC misconfiguration");
	});

	it("should stop without querying events when aborted before first batch", async () => {
		mocks.chainStateFindOne.mockReturnValue(queryResult(null));

		const client = {
			getBlockNumber: vi.fn().mockResolvedValue(106),
			queryFeesCollected: vi.fn().mockResolvedValue([]),
			getBlock: vi.fn().mockResolvedValue({ number: 100, hash: "0xblock100", timestamp: 1_700_000_000 }),
		};
		const abortedController = new AbortController();
		abortedController.abort(); // Abort before starting the sync loop

		await sync(client, config, logger, abortedController.signal);

		expect(client.queryFeesCollected).not.toHaveBeenCalled();
		expect(mocks.feeEventBulkWrite).not.toHaveBeenCalled();
		expect(mocks.chainStateUpdateOne).not.toHaveBeenCalled();
	});
});
