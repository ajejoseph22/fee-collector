const mocks = vi.hoisted(() => ({
	createFeeCollectorClient: vi.fn().mockReturnValue({ mock: "client" }),
}));

vi.mock("@/fee-collector/client", () => ({
	createFeeCollectorClient: mocks.createFeeCollectorClient,
}));

import { Chain } from "@/fee-collector/config/chains.config";
import { createWorkerConfigs, parseChainFlag, sleep } from "@/fee-collector/worker.helpers";

describe("parseChainFlag", () => {
	it("should default to polygon when no --chain flag", () => {
		expect(parseChainFlag(["node", "worker.js"])).toEqual([Chain.Polygon]);
	});

	it("should default to polygon when --chain is last arg with no value", () => {
		expect(parseChainFlag(["node", "worker.js", "--chain"])).toEqual([Chain.Polygon]);
	});

	it("should parse a single chain", () => {
		expect(parseChainFlag(["node", "worker.js", "--chain", "ethereum"])).toEqual([Chain.Ethereum]);
	});

	it("should parse comma-separated chains", () => {
		expect(parseChainFlag(["node", "worker.js", "--chain", "polygon,ethereum"])).toEqual([
			Chain.Polygon,
			Chain.Ethereum,
		]);
	});

	it("should throw on unknown chain", () => {
		expect(() => parseChainFlag(["node", "worker.js", "--chain", "solana"])).toThrow(
			'Unknown chain "solana". Valid chains: polygon, ethereum',
		);
	});
});

describe("createWorkerConfigs", () => {
	it("should map chain definitions to worker configs", () => {
		const definitions = [
			{
				chainId: 137,
				name: Chain.Polygon,
				rpcUrl: "https://polygon-rpc.com",
				contractAddress: "0xcontract",
				startBlock: 100,
				reorgBacktrack: 200,
			},
		];

		const configs = createWorkerConfigs(definitions);

		expect(configs).toHaveLength(1);
		expect(configs[0].chain).toBe(definitions[0]);
		expect(configs[0].syncConfig.chainId).toBe(137);
		expect(configs[0].syncConfig.startBlock).toBe(100);
		expect(configs[0].syncConfig.reorgBacktrack).toBe(200);
		expect(mocks.createFeeCollectorClient).toHaveBeenCalledWith("https://polygon-rpc.com", "0xcontract");
	});
});

describe("sleep", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should resolve after the specified time", async () => {
		// Start sleeping for 1 second
		const sleepPromise = sleep(1000, new AbortController().signal);

		// Advance time by 1 second
		await vi.advanceTimersByTimeAsync(1000);
		await sleepPromise;
		// If we get here, the sleep resolved as expected
	});

	it("should resolve immediately if signal already aborted", async () => {
		// Create an already-aborted signal
		const abortController = new AbortController();
		abortController.abort();

		// Await sleep with the aborted signal
		await sleep(1000, abortController.signal);
		// If we get here without advancing timers, it resolved immediately as expected
	});

	it("should resolve early when signal aborts during sleep", async () => {
		const abortController = new AbortController();
		// Start sleeping for 10 seconds
		const sleepPromise = sleep(10_000, abortController.signal);

		// Advance time by 100ms (sleep should still be pending)
		await vi.advanceTimersByTimeAsync(100);
		// Now abort the signal
		abortController.abort();
		// Await the sleep promise, which should resolve immediately due to the abort
		await sleepPromise;
		// If we get here, the sleep resolved early as expected
	});
});
