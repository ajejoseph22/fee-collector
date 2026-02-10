import mongoose from "mongoose";
import { pino } from "pino";
import { env } from "@/common/utils/env.config";

const logger = pino({ name: "mongo" });

export async function connectMongo(): Promise<typeof mongoose> {
	const uri = env.MONGO_URI;
	const dbName = env.MONGO_DB;

	logger.info({ uri: uri.replace(/\/\/.*@/, "//<credentials>@"), dbName }, "Connecting to MongoDB");

	try {
		const connection = await mongoose.connect(uri, { dbName });

		mongoose.connection.on("error", (err) => {
			logger.error({ err }, "MongoDB connection error");
		});

		mongoose.connection.on("disconnected", () => {
			logger.warn("MongoDB disconnected");
		});

		logger.info("MongoDB connected successfully");
		return connection;
	} catch (err) {
		logger.error({ err }, "Failed to connect to MongoDB");
		throw err;
	}
}

export async function disconnectMongo(): Promise<void> {
	logger.info("Disconnecting from MongoDB");
	await mongoose.disconnect();
	logger.info("MongoDB disconnected");
}
