import os from "node:os";
import { pino } from "pino";

import { connectMongo, disconnectMongo } from "@/common/db/mongo";
import { prettyTransport } from "@/common/utils/logger";
import type { FeeCollectorClient } from "@/fee-collector/client";
import { Chain, SUPPORTED_CHAINS, type ChainDefinition } from "@/fee-collector/chains.config";
import { createFeeCollectorClient } from "@/fee-collector/client";
import { env } from "@/fee-collector/env.config";
import { acquireChainLock, releaseChainLock } from "@/fee-collector/lock.service";
import { sync, type SyncConfig } from "@/fee-collector/sync.service";

const isProduction = env.NODE_ENV === "production";

const logger = pino({
	name: "fee-collector-worker",
	...(!isProduction && { transport: prettyTransport() }),
});

interface WorkerConfig {
	chain: ChainDefinition;
	client: FeeCollectorClient;
	syncConfig: SyncConfig;
}

const abortController = new AbortController();
const lockOwnerId = `${os.hostname()}-${process.pid}`;

async function run(): Promise<void> {
	const chainNames = parseChainFlag();
	const chainDefinitions = chainNames.map((name) => SUPPORTED_CHAINS[name]);
	const workerConfigs = createWorkerConfigs(chainDefinitions);
	const shouldSyncOnce = process.argv.includes("--once");

	await connectMongo(env.MONGO_URI, env.MONGO_DB);
	try {
		logger.info(
			{
				chains: workerConfigs.map((workerConfig) => workerConfig.chain.name),
				pollIntervalMs: env.FEE_COLLECTOR_POLL_INTERVAL_MS,
			},
			"worker started",
		);

		const processIsAborted = () => abortController.signal.aborted;

		while (!processIsAborted()) {
			const results = await Promise.allSettled(
				workerConfigs.map((workerConfig) => syncWithChainLock(workerConfig)),
			);

			let anySyncFailed = false;

			for (const [i, result] of results.entries()) {
				if (result.status === "rejected") {
					anySyncFailed = true;
					logger.error(
						{ chain: workerConfigs[i].chain.name, err: result.reason },
						`sync failed${shouldSyncOnce ? "" : ", will retry after poll interval"}`,
					);
				}
			}

			if (shouldSyncOnce) {
				logger.info("--once flag set, exiting after single cycle");
				if (anySyncFailed) {
					process.exitCode = 1;
				}
				break;
			}

			if (!processIsAborted()) {
				await sleep(env.FEE_COLLECTOR_POLL_INTERVAL_MS, abortController.signal);
			}
		}
	} finally {
		await disconnectMongo();
		logger.info("worker stopped");
	}
}

function onShutdown(): void {
	logger.info("shutdown signal received");
	abortController.abort();
}

process.on("SIGINT", onShutdown);
process.on("SIGTERM", onShutdown);

run().catch((err) => {
	logger.error({ err }, "worker crashed");
	process.exit(1);
});

// -------------------
// HELPER FUNCTIONS
// -------------------
async function syncWithChainLock(workerConfig: WorkerConfig): Promise<void> {
	const chainId = workerConfig.syncConfig.chainId;
	const acquired = await acquireChainLock(chainId, lockOwnerId, env.FEE_COLLECTOR_LOCK_TTL_MS);

	if (!acquired) {
		logger.warn(
			{ chain: workerConfig.chain.name, chainId },
			"chain lock is held by another worker, skipping this cycle",
		);
		return;
	}

	try {
		await sync(workerConfig.client, workerConfig.syncConfig, logger, abortController.signal);
	} finally {
		try {
			await releaseChainLock(chainId, lockOwnerId);
		} catch (error) {
			logger.error(
				{ chain: workerConfig.chain.name, chainId, err: error },
				"failed to release chain lock",
			);
		}
	}
}

function parseChainFlag(): Chain[] {
	const idx = process.argv.indexOf("--chain");
	const chainFlagNotSetOrEmpty = idx === -1 || idx + 1 >= process.argv.length;

	if (chainFlagNotSetOrEmpty) return [Chain.Polygon];

	const rawChains = process.argv[idx + 1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
	const validChains = Object.values(Chain);

	for (const chainName of rawChains) {
		if (!validChains.includes(chainName as Chain)) {
			throw new Error(`Unknown chain "${chainName}". Valid chains: ${validChains.join(", ")}`);
		}
	}

	return rawChains as Chain[];
}

function createWorkerConfigs(chainDefinitions: ChainDefinition[]): WorkerConfig[] {
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();

	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);

		const onAbort = () => done();

		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			resolve();
		}

		signal.addEventListener("abort", onAbort, { once: true });
	});
}
