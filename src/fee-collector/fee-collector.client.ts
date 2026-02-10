import { ethers } from "ethers";
import { FeeCollector__factory } from "lifi-contract-types";
import type { FeeCollector } from "lifi-contract-types";

export interface FeeCollectorClient {
	/** Query all FeesCollected events in the given block range (inclusive). */
	queryFeesCollected(fromBlock: number, toBlock: number): Promise<ethers.Event[]>;
	/** Get block metadata (number, hash, timestamp). */
	getBlock(blockNumber: number): Promise<ethers.providers.Block>;
	/** Get the latest block number from the chain. */
	getBlockNumber(): Promise<number>;
}

/**
 * Creates a typed FeeCollector client bound to a specific RPC and contract address.
 * Uses the TypeChain-generated factory from lifi-contract-types for type-safe event queries.
 */
export function createFeeCollectorClient(rpcUrl: string, contractAddress: string): FeeCollectorClient {
	const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
	const contract: FeeCollector = FeeCollector__factory.connect(contractAddress, provider);

	return {
		async queryFeesCollected(fromBlock: number, toBlock: number): Promise<ethers.Event[]> {
			const filter = contract.filters.FeesCollected();
			return contract.queryFilter(filter, fromBlock, toBlock);
		},

		async getBlock(blockNumber: number): Promise<ethers.providers.Block> {
			return provider.getBlock(blockNumber);
		},

		async getBlockNumber(): Promise<number> {
			return provider.getBlockNumber();
		},
	};
}
