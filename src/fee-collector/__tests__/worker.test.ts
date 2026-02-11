const mocks = vi.hoisted(() => ({
	connectMongo: vi.fn(),
	disconnectMongo: vi.fn(),
	sync: vi.fn(),
	parseChainFlag: vi.fn(),
	createWorkerConfigs: vi.fn(),
	sleep: vi.fn(),
}));

vi.mock("@/common/db/mongo", () => ({
	connectMongo: mocks.connectMongo,
	disconnectMongo: mocks.disconnectMongo,
}));

vi.mock("@/fee-collector/services/sync.service", () => ({
	sync: mocks.sync,
}));

vi.mock("@/fee-collector/worker.helpers", () => ({
	parseChainFlag: mocks.parseChainFlag,
	createWorkerConfigs: mocks.createWorkerConfigs,
	sleep: mocks.sleep,
}));

vi.mock("@/fee-collector/config/chains.config", () => ({
	SUPPORTED_CHAINS: {
		polygon: { chainId: 137, name: "polygon" },
		ethereum: { chainId: 1, name: "ethereum" },
	},
}));

vi.mock("@/fee-collector/config/env.config", () => ({
	env: {
		MONGO_URI: "mongodb://localhost:27017",
		MONGO_DB: "test-db",
		FEE_COLLECTOR_POLL_INTERVAL_MS: 1000,
	},
}));

import type { Logger } from "pino";
import { run } from "@/fee-collector/worker";

const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger;

function createWorkerConfig(chainName: string) {
	return {
		chain: { name: chainName },
		client: { mock: `${chainName}-client` },
		syncConfig: { chainId: chainName === "polygon" ? 137 : 1 },
	};
}

describe("Worker run()", () => {
	const polygonConfig = createWorkerConfig("polygon");

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;

		mocks.connectMongo.mockResolvedValue(undefined);
		mocks.disconnectMongo.mockResolvedValue(undefined);
		mocks.sleep.mockResolvedValue(undefined);
		mocks.parseChainFlag.mockReturnValue(["polygon"]);
		mocks.createWorkerConfigs.mockReturnValue([polygonConfig]);
		mocks.sync.mockResolvedValue(undefined);
	});

	describe("--once mode", () => {
		it("should connect mongo, sync, disconnect, and not set exitCode on success", async () => {
			const ac = new AbortController();

			await run(["node", "worker.ts", "--once"], ac.signal, logger);

			expect(mocks.connectMongo).toHaveBeenCalledWith("mongodb://localhost:27017", "test-db");
			expect(mocks.sync).toHaveBeenCalledTimes(1);
			expect(mocks.disconnectMongo).toHaveBeenCalledTimes(1);
			expect(process.exitCode).toBeUndefined();
		});

		it("should set process.exitCode = 1 when sync rejects and log the error", async () => {
			mocks.sync.mockRejectedValue(new Error("RPC down"));
			const ac = new AbortController();

			await run(["node", "worker.ts", "--once"], ac.signal, logger);

			expect(process.exitCode).toBe(1);
			expect(mocks.disconnectMongo).toHaveBeenCalledTimes(1);
			expect(logger.error).toHaveBeenCalledWith({ chain: "polygon", err: expect.any(Error) }, "sync failed");
		});

		it("should handle multi-chain mixed results properly", async () => {
			const ethereumConfig = createWorkerConfig("ethereum");
			mocks.parseChainFlag.mockReturnValue(["polygon", "ethereum"]);
			mocks.createWorkerConfigs.mockReturnValue([polygonConfig, ethereumConfig]);
			mocks.sync
				.mockResolvedValueOnce(undefined) // polygon succeeds
				.mockRejectedValueOnce(new Error("ethereum RPC down")); // ethereum fails
			const ac = new AbortController();

			await run(["node", "worker.ts", "--chain", "polygon,ethereum", "--once"], ac.signal, logger);

			expect(mocks.sync).toHaveBeenCalledTimes(2);
			expect(process.exitCode).toBe(1);
			expect(mocks.disconnectMongo).toHaveBeenCalledTimes(1);
			expect(logger.error).toHaveBeenCalledWith({ chain: "ethereum", err: expect.any(Error) }, "sync failed");
			expect(logger.error).not.toHaveBeenCalledWith(expect.objectContaining({ chain: "polygon" }), expect.any(String));
		});
	});

	describe("Continuous mode", () => {
		it("should run multiple sync cycles with sleep between them until abort", async () => {
			const abortController = new AbortController();
			let syncCallCount = 0;
			// mock sync to automatically abort after 3 calls to exit the loop
			mocks.sync.mockImplementation(async () => {
				syncCallCount++;
				if (syncCallCount >= 3) {
					abortController.abort();
				}
			});

			await run(["node", "worker.ts"], abortController.signal, logger);

			expect(mocks.sync).toHaveBeenCalledTimes(3);
			// sleep is called between cycles, but not after the last one (abort stops the loop)
			expect(mocks.sleep).toHaveBeenCalledTimes(2);
			expect(mocks.sleep).toHaveBeenCalledWith(1000, abortController.signal);
		});

		it("should disconnect mongo cleanly on graceful shutdown", async () => {
			const abortController = new AbortController();
			mocks.sync.mockImplementation(async () => {
				abortController.abort();
			});

			await run(["node", "worker.ts"], abortController.signal, logger);

			expect(mocks.disconnectMongo).toHaveBeenCalledTimes(1);
		});

		it("should log error with retry message when sync fails in continuous mode", async () => {
			const abortController = new AbortController();
			let syncCallCount = 0;

			mocks.sync.mockImplementation(async () => {
				syncCallCount++;
				if (syncCallCount === 1) {
					throw new Error("RPC down");
				}
				// abort on second cycle to exit the loop
				abortController.abort();
			});

			await run(["node", "worker.ts"], abortController.signal, logger);

			expect(logger.error).toHaveBeenCalledWith(
				{ chain: "polygon", err: expect.any(Error) },
				"sync failed, will retry after poll interval",
			);
		});
	});

	describe("Abort signal propagation", () => {
		it("should forward the signal to each sync() call", async () => {
			const ac = new AbortController();

			await run(["node", "worker.ts", "--once"], ac.signal, logger);

			expect(mocks.sync).toHaveBeenCalledWith(polygonConfig.client, polygonConfig.syncConfig, logger, ac.signal);
		});
	});

	describe("MongoDB lifecycle", () => {
		it("should call connectMongo before sync", async () => {
			const callOrder: string[] = [];
			mocks.connectMongo.mockImplementation(async () => {
				callOrder.push("connect");
			});
			mocks.sync.mockImplementation(async () => {
				callOrder.push("sync");
			});

			await run(["node", "worker.ts", "--once"], new AbortController().signal, logger);

			expect(callOrder).toEqual(["connect", "sync"]);
		});

		it("should call disconnectMongo on program exit even when sync throws", async () => {
			mocks.sync.mockRejectedValue(new Error("some RPC error"));

			await run(["node", "worker.ts", "--once"], new AbortController().signal, logger);

			expect(mocks.disconnectMongo).toHaveBeenCalledTimes(1);
		});
	});
});
