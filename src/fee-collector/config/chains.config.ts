import { env } from "@/fee-collector/config/env.config";

export enum Chain {
	Polygon = "polygon",
	Ethereum = "ethereum",
}

export interface ChainDefinition {
	chainId: number;
	name: Chain;
	rpcUrl: string;
	contractAddress: string;
	startBlock: number;
	reorgBacktrack: number;
}

/**
 * Static registry of all supported EVM chains.
 *
 * To add a new chain:
 * 1. Add a value to the Chain enum
 * 2. Add its env vars to fee-collector/env.config.ts
 * 3. Add an entry here keyed by the enum value
 *
 * Operational note: run at most one worker per chain. Multiple workers for the
 * same chain will mess up the chain_sync_state (each worker overwrites `lastProcessedBlock`),
 * causing redundant block re-scanning and wasted RPC calls. Upserts prevent
 * duplicate events, but the overhead is significant.
 */
export const SUPPORTED_CHAINS: Partial<Record<Chain, ChainDefinition>> = {
	[Chain.Polygon]: {
		chainId: 137,
		name: Chain.Polygon,
		rpcUrl: env.FEE_COLLECTOR_POLYGON_RPC,
		contractAddress: env.FEE_COLLECTOR_POLYGON_ADDRESS,
		startBlock: env.FEE_COLLECTOR_POLYGON_START_BLOCK,
		reorgBacktrack: env.FEE_COLLECTOR_POLYGON_REORG_BACKTRACK,
	},
	// Extensibility POC only:
	// [Chain.Ethereum]: {
	// 	chainId: 1,
	// 	name: Chain.Ethereum,
	// 	rpcUrl: env.FEE_COLLECTOR_ETHEREUM_RPC,
	// 	contractAddress: env.FEE_COLLECTOR_ETHEREUM_ADDRESS,
	// 	startBlock: env.FEE_COLLECTOR_ETHEREUM_START_BLOCK,
	// 	reorgBacktrack: env.FEE_COLLECTOR_ETHEREUM_REORG_BACKTRACK,
	// },
};
