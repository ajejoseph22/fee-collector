import { BigNumber, type ethers } from "ethers";

const mocks = vi.hoisted(() => ({
	parseLog: vi.fn(),
}));

vi.mock("lifi-contract-types", () => ({
	FeeCollector__factory: {
		createInterface: () => ({ parseLog: mocks.parseLog }),
	},
}));

import { parseFeeCollectedEvents } from "@/fee-collector/services/parsing.service";

const rawEvent = {
	blockNumber: 100,
	blockHash: "0xblockhash",
	transactionHash: "0xtxhash",
	logIndex: 2,
	data: "0x",
	topics: [],
} as unknown as ethers.Event;

describe("parseFeeCollectedEvents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should map decoded event args to valid DTO", () => {
		mocks.parseLog.mockReturnValue({
			args: [
				"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // token (mixed case)
				"0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", // integrator (mixed case)
				BigNumber.from("1000000000000000000"), // integratorFee
				BigNumber.from("42"), // lifiFee
			],
		});
		const blockTimestamps = new Map([[100, 1_700_000_000]]);

		const result = parseFeeCollectedEvents([rawEvent], 137, blockTimestamps);

		expect(result).toEqual([
			{
				chainId: 137,
				blockNumber: 100,
				blockHash: "0xblockhash",
				txHash: "0xtxhash",
				logIndex: 2,
				token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				integrator: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				integratorFee: "1000000000000000000",
				lifiFee: "42",
				blockTimestamp: 1_700_000_000,
			},
		]);
	});

	it("should throw an error when a block timestamp is missing", () => {
		mocks.parseLog.mockReturnValue({
			args: [
				"0x1111111111111111111111111111111111111111",
				"0x2222222222222222222222222222222222222222",
				BigNumber.from("1"),
				BigNumber.from("2"),
			],
		});
		const emptyTimestamps = new Map();

		expect(() => parseFeeCollectedEvents([rawEvent], 1, emptyTimestamps)).toThrow(
			"Missing block timestamp for block 100",
		);
	});
});
