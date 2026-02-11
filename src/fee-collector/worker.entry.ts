import { pino } from "pino";
import { prettyTransport } from "@/common/utils/logger";
import { run } from "@/fee-collector/worker";

const logger = pino({
	name: "fee-collector-worker",
	transport: prettyTransport(),
});
const abortController = new AbortController();

function onShutdown(): void {
	logger.info("shutdown signal received");
	abortController.abort();
}

process.on("SIGINT", onShutdown);
process.on("SIGTERM", onShutdown);
run(process.argv, abortController.signal, logger).catch((err) => {
	logger.error({ err }, "worker crashed");
	process.exit(1);
});
