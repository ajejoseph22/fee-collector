import type { FeeCollectorClient } from "@/fee-collector/client";
import { createFeeCollectorClient } from "@/fee-collector/client";
import { Chain, type ChainDefinition } from "@/fee-collector/config/chains.config";
import { env } from "@/fee-collector/config/env.config";
import type { SyncConfig } from "@/fee-collector/services/sync.service";

export interface WorkerConfig {
	chain: ChainDefinition;
	client: FeeCollectorClient;
	syncConfig: SyncConfig;
}

export function parseChainFlag(argv: string[]): Chain[] {
	const flagIndex = argv.indexOf("--chain");
	const chainFlagNotSetOrEmpty = flagIndex === -1 || flagIndex + 1 >= argv.length;

	if (chainFlagNotSetOrEmpty) return [Chain.Polygon];

	const rawChains = argv[flagIndex + 1]
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const validChains = Object.values(Chain);

	for (const chainName of rawChains) {
		if (!validChains.includes(chainName as Chain)) {
			throw new Error(`Unknown chain "${chainName}". Valid chains: ${validChains.join(", ")}`);
		}
	}

	return rawChains as Chain[];
}

export function createWorkerConfigs(chainDefinitions: ChainDefinition[]): WorkerConfig[] {
	return chainDefinitions.map((definition) => ({
		chain: definition,
		client: createFeeCollectorClient(definition.rpcUrl, definition.contractAddress),
		syncConfig: {
			chainId: definition.chainId,
			startBlock: definition.startBlock,
			confirmations: env.FEE_COLLECTOR_CONFIRMATIONS,
			batchSize: env.FEE_COLLECTOR_BATCH_SIZE,
			reorgBacktrack: definition.reorgBacktrack,
			batchDelayMs: env.FEE_COLLECTOR_BATCH_DELAY_MS,
		},
	}));
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();

	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};

		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}
