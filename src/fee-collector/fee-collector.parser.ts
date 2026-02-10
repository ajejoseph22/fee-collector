import { BigNumber, ethers } from "ethers";
import { FeeCollector__factory } from "lifi-contract-types";

/** Shape that matches the FeeCollectedEvent Typegoose model (excluding createdAt). */
export interface ParsedFeeCollectedEvent {
	chainId: number;
	blockNumber: number;
	blockHash: string;
	txHash: string;
	logIndex: number;
	token: string;
	integrator: string;
	integratorFee: string;
	lifiFee: string;
	blockTimestamp: number;
}

const feeCollectorInterface = FeeCollector__factory.createInterface();

/**
 * Parses raw ethers events into DTOs ready for MongoDB insertion.
 *
 * @param events       Raw events from contract.queryFilter()
 * @param chainId      The chain these events came from (e.g. 137 for Polygon)
 * @param blockTimestamps  Map of blockNumber → unix timestamp (seconds).
 *                         The caller is responsible for fetching blocks and building this map.
 */
export function parseFeeCollectedEvents(
	events: ethers.Event[],
	chainId: number,
	blockTimestamps: Map<number, number>,
): ParsedFeeCollectedEvent[] {
	return events.map((event) => {
		const parsed = feeCollectorInterface.parseLog(event);

		const timestamp = blockTimestamps.get(event.blockNumber);
		if (!timestamp) {
			throw new Error(`Missing block timestamp for block ${event.blockNumber}`);
		}

		return {
			chainId,
			blockNumber: event.blockNumber,
			blockHash: event.blockHash,
			txHash: event.transactionHash,
			logIndex: event.logIndex,
			token: (parsed.args[0] as string).toLowerCase(),
			integrator: (parsed.args[1] as string).toLowerCase(),
			integratorFee: BigNumber.from(parsed.args[2]).toString(),
			lifiFee: BigNumber.from(parsed.args[3]).toString(),
			blockTimestamp: timestamp,
		};
	});
}
