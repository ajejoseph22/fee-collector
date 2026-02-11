import { StatusCodes } from "http-status-codes";
import type { Logger } from "pino";
import type { Mock } from "vitest";
import type { FeeEventRow, FeeRepository } from "@/api/fee/fee.repository";
import { FeeService, FeeServiceError } from "@/api/fee/fee.service";

interface LoggerWithErrorOnly extends Pick<Logger, "error"> {}

describe("FeeService", () => {
	let repositoryMock: { findByIntegrator: Mock };
	let loggerMock: LoggerWithErrorOnly;
	let feeService: FeeService;

	// Helpers
	const createRow = (overrides: Partial<FeeEventRow> = {}): FeeEventRow => ({
		id: "64b1f7b7396b38f8f4b8a3f1",
		chainId: 137,
		blockNumber: 100,
		blockHash: "0xaaa",
		txHash: "0x111",
		logIndex: 1,
		token: "0x1111111111111111111111111111111111111111",
		integrator: "0x2222222222222222222222222222222222222222",
		integratorFee: "10",
		lifiFee: "2",
		blockTimestamp: 1_700_000_000,
		...overrides,
	});
	const encodeCursor = (payload: { blockNumber: number; logIndex: number; id: string }) =>
		Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
	const decodeCursor = (cursor: string) => JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));

	beforeEach(() => {
		repositoryMock = {
			findByIntegrator: vi.fn(),
		};
		loggerMock = {
			error: vi.fn(),
		};
		feeService = new FeeService(repositoryMock as unknown as FeeRepository, loggerMock as Logger);
	});

	describe("findByIntegrator", () => {
		it("should return first page and build next cursor from the last returned row", async () => {
			const rows = [
				createRow(),
				createRow({
					id: "64b1f7b7396b38f8f4b8a3f2",
					blockNumber: 101,
					blockHash: "0xbbb",
					txHash: "0x222",
					logIndex: 2,
					token: "0x3333333333333333333333333333333333333333",
					integratorFee: "11",
					lifiFee: "3",
					blockTimestamp: 1_700_000_001,
				}),
				createRow({
					id: "64b1f7b7396b38f8f4b8a3f3",
					blockNumber: 102,
					blockHash: "0xccc",
					txHash: "0x333",
					logIndex: 3,
					token: "0x4444444444444444444444444444444444444444",
					integratorFee: "12",
					lifiFee: "4",
					blockTimestamp: 1_700_000_002,
				}),
			];
			repositoryMock.findByIntegrator.mockResolvedValue(rows);

			const result = await feeService.findByIntegrator("0xabc", 137, undefined, 2);

			expect(repositoryMock.findByIntegrator).toHaveBeenCalledWith({
				integrator: "0xabc",
				chainId: 137,
				cursor: undefined,
				limit: 2,
			});
			expect(result.data).toEqual([
				{
					chainId: 137,
					blockNumber: 100,
					blockHash: "0xaaa",
					txHash: "0x111",
					logIndex: 1,
					token: "0x1111111111111111111111111111111111111111",
					integrator: "0x2222222222222222222222222222222222222222",
					integratorFee: "10",
					lifiFee: "2",
					blockTimestamp: 1_700_000_000,
				},
				{
					chainId: 137,
					blockNumber: 101,
					blockHash: "0xbbb",
					txHash: "0x222",
					logIndex: 2,
					token: "0x3333333333333333333333333333333333333333",
					integrator: "0x2222222222222222222222222222222222222222",
					integratorFee: "11",
					lifiFee: "3",
					blockTimestamp: 1_700_000_001,
				},
			]);
			expect(result.cursor).not.toBeNull();

			const decodedCursor = decodeCursor(result.cursor as string);
			expect(decodedCursor).toEqual({
				blockNumber: 101,
				logIndex: 2,
				id: "64b1f7b7396b38f8f4b8a3f2",
			});
		});

		it("should return cursor as null when there is no next page", async () => {
			repositoryMock.findByIntegrator.mockResolvedValue([createRow({ chainId: 1 })]);

			const result = await feeService.findByIntegrator("0xabc", undefined, undefined, 5);

			expect(result.cursor).toBeNull();
			expect(result.data).toHaveLength(1);
		});

		it("should clamp limit to max and min bounds (1 and 200) before querying repository", async () => {
			repositoryMock.findByIntegrator.mockResolvedValue([]);

			await feeService.findByIntegrator("0xabc", undefined, undefined, 10_000);
			await feeService.findByIntegrator("0xabc", undefined, undefined, 0);

			expect(repositoryMock.findByIntegrator).toHaveBeenNthCalledWith(1, {
				integrator: "0xabc",
				chainId: undefined,
				cursor: undefined,
				limit: 200,
			});
			expect(repositoryMock.findByIntegrator).toHaveBeenNthCalledWith(2, {
				integrator: "0xabc",
				chainId: undefined,
				cursor: undefined,
				limit: 1,
			});
		});

		it("should throw INVALID_CURSOR when cursor payload is malformed", async () => {
			await expect(feeService.findByIntegrator("0xabc", undefined, "not-base64", 10)).rejects.toMatchObject({
				statusCode: StatusCodes.BAD_REQUEST,
				code: "INVALID_CURSOR",
				message: "Invalid cursor",
			});
			expect(repositoryMock.findByIntegrator).not.toHaveBeenCalled();
			expect(loggerMock.error).not.toHaveBeenCalled();
		});

		it("should pass decoded cursor to repository when cursor is valid", async () => {
			repositoryMock.findByIntegrator.mockResolvedValue([]);
			const cursorObject = {
				blockNumber: 100,
				logIndex: 5,
				id: "64b1f7b7396b38f8f4b8a3f2",
			};
			const cursor = encodeCursor(cursorObject);

			await feeService.findByIntegrator("0xabc", 1, cursor, 10);

			expect(repositoryMock.findByIntegrator).toHaveBeenCalledWith({
				integrator: "0xabc",
				chainId: 1,
				cursor: cursorObject,
				limit: 10,
			});
		});

		it("should wrap unknown errors into INTERNAL_ERROR and log context", async () => {
			repositoryMock.findByIntegrator.mockRejectedValue(new Error("db down"));

			await expect(feeService.findByIntegrator("0xabc")).rejects.toMatchObject({
				statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
				code: "INTERNAL_ERROR",
				message: "An error occurred while retrieving fees.",
			});

			expect(loggerMock.error).toHaveBeenCalledWith(
				expect.stringContaining("Error finding fees for integrator 0xabc: db down"),
			);
		});

		it("should rethrow FeeServiceError without logging it again", async () => {
			const customError = new FeeServiceError(StatusCodes.BAD_REQUEST, "INVALID_CURSOR", "Invalid cursor");
			repositoryMock.findByIntegrator.mockRejectedValue(customError);

			await expect(feeService.findByIntegrator("0xabc")).rejects.toBe(customError);
			expect(loggerMock.error).not.toHaveBeenCalled();
		});
	});
});
