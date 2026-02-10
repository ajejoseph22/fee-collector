import { env } from "@/common/utils/env.config";
import { connectMongo, disconnectMongo } from "@/common/db/mongo";
import { app, logger } from "@/server";

async function main() {
	await connectMongo(env.MONGO_URI, env.MONGO_DB);

	const server = app.listen(env.PORT, () => {
		const { NODE_ENV, HOST, PORT } = env;
		logger.info(`Server (${NODE_ENV}) running on port http://${HOST}:${PORT}`);
	});

	const onCloseSignal = async () => {
		logger.info("Shutdown signal received, shutting down");
		server.close(async () => {
			await disconnectMongo();
			logger.info("Server closed");
			process.exit();
		});
		setTimeout(() => process.exit(1), 10000).unref();
	};

	process.on("SIGINT", onCloseSignal);
	process.on("SIGTERM", onCloseSignal);
}

main().catch((err) => {
	logger.error({ err }, "Failed to start server");
	process.exit(1);
});
