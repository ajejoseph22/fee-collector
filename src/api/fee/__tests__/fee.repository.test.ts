import { Types } from "mongoose";
import {describe, Mock} from "vitest";

import { FeeRepository } from "@/api/fee/fee.repository";
import { FeeCollectedEventModel } from "@/fee-collector/models/fee-collected-event";

vi.mock("@/fee-collector/models/fee-collected-event", () => ({
	FeeCollectedEventModel: {
		find: vi.fn(),
	},
}));

describe("FeeRepository", () => {
	let feeRepository: FeeRepository;
	let findMock: Mock;
	let sortMock: Mock;
	let limitMock: Mock;
	let leanMock: Mock;
	let execMock: Mock;

	const createDoc = (overrides: Record<string, unknown> = {}) => ({
		_id: new Types.ObjectId(),
		chainId: 137,
		blockNumber: 100,
		blockHash: "0xaaa",
		txHash: "0xbbb",
		logIndex: 1,
		token: "0x1111111111111111111111111111111111111111",
		integrator: "0x2222222222222222222222222222222222222222",
		integratorFee: "10",
		lifiFee: "2",
		blockTimestamp: 1_700_000_000,
		...overrides,
	});

	beforeEach(() => {
		feeRepository = new FeeRepository();
		findMock = FeeCollectedEventModel.find as unknown as Mock;
		sortMock = vi.fn();
		limitMock = vi.fn();
		leanMock = vi.fn();
		execMock = vi.fn();

		const queryChain = {
			sort: sortMock,
			limit: limitMock,
			lean: leanMock,
			exec: execMock,
		};

		findMock.mockReturnValue(queryChain);
		sortMock.mockReturnValue(queryChain);
		limitMock.mockReturnValue(queryChain);
		leanMock.mockReturnValue(queryChain);
	});

	describe("findByIntegrator", () => {
		it("queries by normalized integrator and maps documents", async () => {
			const docs = [
				createDoc(),
				createDoc({
					blockNumber: 101,
					blockHash: "0xccc",
					txHash: "0xddd",
					logIndex: 2,
					token: "0x3333333333333333333333333333333333333333",
					integratorFee: "11",
					lifiFee: "3",
					blockTimestamp: 1_700_000_001,
				}),
			];
			execMock.mockResolvedValue(docs);

			const result = await feeRepository.findByIntegrator({
				integrator: "0xABCDEF",
				limit: 2,
			});

			expect(findMock).toHaveBeenCalledWith({ integrator: "0xabcdef" });
			expect(sortMock).toHaveBeenCalledWith({ blockNumber: 1, logIndex: 1, _id: 1 });
			expect(limitMock).toHaveBeenCalledWith(3);
			expect(leanMock).toHaveBeenCalled();
			expect(execMock).toHaveBeenCalled();
			expect(result).toEqual([
				{
					id: String(docs[0]?._id),
					chainId: 137,
					blockNumber: 100,
					blockHash: "0xaaa",
					txHash: "0xbbb",
					logIndex: 1,
					token: "0x1111111111111111111111111111111111111111",
					integrator: "0x2222222222222222222222222222222222222222",
					integratorFee: "10",
					lifiFee: "2",
					blockTimestamp: 1_700_000_000,
				},
				{
					id: String(docs[1]?._id),
					chainId: 137,
					blockNumber: 101,
					blockHash: "0xccc",
					txHash: "0xddd",
					logIndex: 2,
					token: "0x3333333333333333333333333333333333333333",
					integrator: "0x2222222222222222222222222222222222222222",
					integratorFee: "11",
					lifiFee: "3",
					blockTimestamp: 1_700_000_001,
				},
			]);
		});

		it("should apply chain and cursor filters for pagination", async () => {
			execMock.mockResolvedValue([]);

			await feeRepository.findByIntegrator({
				integrator: "0xaaaa",
				chainId: 1,
				cursor: {
					blockNumber: 100,
					logIndex: 3,
					id: "64b1f7b7396b38f8f4b8a3f2",
				},
				limit: 25,
			});

			const filter = findMock.mock.calls[0][0] as Record<string, unknown>;

			const cursorCondition = filter.$or as Array<Record<string, unknown>>;
			expect(cursorCondition).toEqual([
				{ blockNumber: { $gt: 100 } },
				{ blockNumber: 100, logIndex: { $gt: 3 } },
				{
					blockNumber: 100,
					logIndex: 3,
					_id: { $gt: expect.any(Types.ObjectId) },
				},
			]);
			expect(limitMock).toHaveBeenCalledWith(26); // limit + 1 for pagination check
		});
	});
});
