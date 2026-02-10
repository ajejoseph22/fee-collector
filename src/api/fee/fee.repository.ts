import { Types } from "mongoose";

import type { FeeEvent } from "@/api/fee/fee.model";
import { FeeCollectedEventModel } from "@/fee-collector/models/fee-collected-event";

export interface FeesCursor {
	blockNumber: number;
	logIndex: number;
	id: string;
}

interface FindByIntegratorOptions {
	integrator: string;
	chainId?: number;
	cursor?: FeesCursor;
	limit: number;
}

export interface FeeEventRow extends FeeEvent {
	id: string;
}

export class FeeRepository {
	async findByIntegrator(options: FindByIntegratorOptions): Promise<FeeEventRow[]> {
		const filter: Record<string, unknown> = { integrator: options.integrator.toLowerCase() };

		if (options.chainId !== undefined) {
			filter.chainId = options.chainId;
		}

		if (options.cursor) {
			filter.$or = [
				{ blockNumber: { $gt: options.cursor.blockNumber } },
				{ blockNumber: options.cursor.blockNumber, logIndex: { $gt: options.cursor.logIndex } },
				{
					blockNumber: options.cursor.blockNumber,
					logIndex: options.cursor.logIndex,
					_id: { $gt: new Types.ObjectId(options.cursor.id) },
				},
			];
		}

		const docs = await FeeCollectedEventModel.find(filter)
			.sort({ blockNumber: 1, logIndex: 1, _id: 1 })
			.limit(options.limit + 1)
			.lean()
			.exec();

		return docs.map((doc) => ({
			id: String(doc._id),
			chainId: doc.chainId,
			blockNumber: doc.blockNumber,
			blockHash: doc.blockHash,
			txHash: doc.txHash,
			logIndex: doc.logIndex,
			token: doc.token,
			integrator: doc.integrator,
			integratorFee: doc.integratorFee,
			lifiFee: doc.lifiFee,
			blockTimestamp: doc.blockTimestamp,
		}));
	}
}
