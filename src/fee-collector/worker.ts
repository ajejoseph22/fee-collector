import type { Logger } from "pino";
import { connectMongo, disconnectMongo } from "@/common/db/mongo";
import { type ChainDefinition, SUPPORTED_CHAINS } from "@/fee-collector/config/chains.config";
import { env } from "@/fee-collector/config/env.config";
import { sync } from "@/fee-collector/services/sync.service";
import { createWorkerConfigs, parseChainFlag, sleep } from "@/fee-collector/worker.helpers";

export async function run(argv: string[], signal: AbortSignal, logger: Logger): Promise<void> {
	const chainNames = parseChainFlag(argv);
	const chainDefinitions = chainNames
		.filter((name) => {
			if (!SUPPORTED_CHAINS[name]) {
				logger.warn({ chain: name }, "chain recognized (extensibility POC only) but not yet supported, skipping...");
				return false;
			}
			return true;
		})
		.map((name) => SUPPORTED_CHAINS[name] as ChainDefinition);

	if (!chainDefinitions.length) {
		logger.warn("no supported chains to sync");
		return;
	}

	const workerConfigs = createWorkerConfigs(chainDefinitions);
	const shouldSyncOnce = argv.includes("--once");

	await connectMongo(env.MONGO_URI, env.MONGO_DB);
	logger.info(
		{
			chains: workerConfigs.map((workerConfig) => workerConfig.chain.name),
			pollIntervalMs: env.FEE_COLLECTOR_POLL_INTERVAL_MS,
		},
		"worker started",
	);

	const processIsAborted = () => signal.aborted;

	while (!processIsAborted()) {
		const results = await Promise.allSettled(
			workerConfigs.map((workerConfig) => sync(workerConfig.client, workerConfig.syncConfig, logger, signal)),
		);

		// Check if shutdown was requested during sync. If so, exit immediately
		if (processIsAborted()) {
			logger.info("Gracefully shutting down...");
			break;
		}

		let anySyncFailed = false;

		// Log sync results and errors if any
		for (const [i, result] of results.entries()) {
			if (result.status === "rejected") {
				anySyncFailed = true;
				logger.error(
					{ chain: workerConfigs[i].chain.name, err: result.reason },
					`sync failed${shouldSyncOnce ? "" : ", will retry after poll interval"}`,
				);
			}
		}

		// If --once flag is set, exit after the first cycle regardless of success or failure
		if (shouldSyncOnce) {
			logger.info("--once flag set, exiting after single cycle");

			if (anySyncFailed) {
				process.exitCode = 1;
			}

			break;
		}

		await sleep(env.FEE_COLLECTOR_POLL_INTERVAL_MS, signal);
	}

	await disconnectMongo();
	logger.info("worker stopped");
}
