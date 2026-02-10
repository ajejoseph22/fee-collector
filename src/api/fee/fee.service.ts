import { StatusCodes } from "http-status-codes";
import type { Logger } from "pino";
import { z } from "zod";

import type { FeeEventList } from "@/api/fee/fee.model";
import type { FeeEventRow, FeesCursor } from "./fee.repository";
import { FeeRepository } from "./fee.repository";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const cursorSchema = z.object({
	blockNumber: z.number().int(),
	logIndex: z.number().int(),
	id: z.string().regex(OBJECT_ID_PATTERN),
});

export class FeeServiceError extends Error {
	constructor(
		public readonly statusCode: number,
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "FeeServiceError";
	}
}

export class FeeService {
	constructor(
		private readonly feesRepository: FeeRepository,
		private readonly logger: Logger,
	) {}

	async findByIntegrator(
		integrator: string,
		chainId?: number,
		cursor?: string,
		limit: number = DEFAULT_LIMIT,
	): Promise<FeeEventList> {
		try {
			const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
			let decodedCursor: FeesCursor | undefined;

			if (cursor) {
				decodedCursor = decodeCursor(cursor);
				if (!decodedCursor) {
					throw new FeeServiceError(StatusCodes.BAD_REQUEST, "INVALID_CURSOR", "Invalid cursor");
				}
			}

			const rows = await this.feesRepository.findByIntegrator({
				integrator,
				chainId,
				cursor: decodedCursor,
				limit: safeLimit,
			});

			const hasNextPage = rows.length > safeLimit;
			// Only take rows up to safeLimit for the current page
			const pageRows = hasNextPage ? rows.slice(0, safeLimit) : rows;
			const data = mapRowsToEvents(pageRows);

			// Generate cursor for the next page if there is one.
			// We use the last item of the current page as the cursor reference point.
			const lastRow = pageRows[pageRows.length - 1];
			const nextCursor =
				hasNextPage && lastRow
					? encodeCursor({
							blockNumber: lastRow.blockNumber,
							logIndex: lastRow.logIndex,
							id: lastRow.id,
						})
					: null;

			return {
				data,
				cursor: nextCursor,
			};
		} catch (error) {
			if (error instanceof FeeServiceError) {
				throw error;
			}

			const errorMessage = `Error finding fees for integrator ${integrator}: ${(error as Error).message}`;
			this.logger.error(errorMessage);
			throw new FeeServiceError(
				StatusCodes.INTERNAL_SERVER_ERROR,
				"INTERNAL_ERROR",
				"An error occurred while retrieving fees.",
			);
		}
	}
}

/**
 * Cursor format:
 * base64(JSON.stringify({ blockNumber, logIndex, id }))
 *
 * Ordering semantics:
 * events are sorted lexicographically by (blockNumber ASC, logIndex ASC, _id ASC),
 * and pagination continues from the strict successor of that tuple.
 */
function encodeCursor(payload: FeesCursor): string {
	return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

function decodeCursor(cursor: string): FeesCursor | undefined {
	try {
		const decoded = Buffer.from(cursor, "base64").toString("utf-8");
		const parsed = cursorSchema.safeParse(JSON.parse(decoded));

		return parsed.success ? parsed.data : undefined;
	} catch {
		return;
	}
}

function mapRowsToEvents(rows: FeeEventRow[]) {
	return rows.map((row) => ({
		chainId: row.chainId,
		blockNumber: row.blockNumber,
		blockHash: row.blockHash,
		txHash: row.txHash,
		logIndex: row.logIndex,
		token: row.token,
		integrator: row.integrator,
		integratorFee: row.integratorFee,
		lifiFee: row.lifiFee,
		blockTimestamp: row.blockTimestamp,
	}));
}