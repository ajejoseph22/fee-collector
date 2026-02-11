const mocks = vi.hoisted(() => {
	const provider = {
		getBlock: vi.fn(),
		getBlockNumber: vi.fn(),
	};
	const contract = {
		filters: { FeesCollected: vi.fn() },
		queryFilter: vi.fn(),
	};
	return {
		provider,
		contract,
		StaticJsonRpcProvider: vi.fn(),
		connect: vi.fn(),
	};
});

vi.mock("ethers", () => ({
	ethers: {
		providers: {
			StaticJsonRpcProvider: mocks.StaticJsonRpcProvider,
		},
	},
}));

vi.mock("lifi-contract-types", () => ({
	FeeCollector__factory: {
		connect: mocks.connect,
	},
}));

import { createFeeCollectorClient } from "@/fee-collector/client";

describe("createFeeCollectorClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mocks.provider.getBlock.mockResolvedValue({ number: 123, hash: "0xabc", timestamp: 1_700_000_000 });
		mocks.provider.getBlockNumber.mockResolvedValue(456);
		mocks.contract.filters.FeesCollected.mockReturnValue("fees-filter");
		mocks.contract.queryFilter.mockResolvedValue([{ id: "event-1" }]);

		mocks.StaticJsonRpcProvider.mockReturnValue(mocks.provider);
		mocks.connect.mockReturnValue(mocks.contract);
	});

	it("should create provider and contract, then delegate event queries", async () => {
		const client = createFeeCollectorClient("https://rpc.example", "0xcontract");

		const events = await client.queryFeesCollected(100, 200);

		expect(mocks.StaticJsonRpcProvider).toHaveBeenCalledWith("https://rpc.example");
		expect(mocks.connect).toHaveBeenCalledWith("0xcontract", mocks.provider);
		expect(mocks.contract.filters.FeesCollected).toHaveBeenCalledTimes(1);
		expect(mocks.contract.queryFilter).toHaveBeenCalledWith("fees-filter", 100, 200);
		expect(events).toEqual([{ id: "event-1" }]);
	});

	it("should delegate block lookups to the provider", async () => {
		const client = createFeeCollectorClient("https://rpc.example", "0xcontract");

		const block = await client.getBlock(123);
		const latestBlockNumber = await client.getBlockNumber();

		expect(mocks.provider.getBlock).toHaveBeenCalledWith(123);
		expect(mocks.provider.getBlockNumber).toHaveBeenCalledTimes(1);
		expect(block).toEqual({ number: 123, hash: "0xabc", timestamp: 1_700_000_000 });
		expect(latestBlockNumber).toBe(456);
	});
});
