import mongoose from "mongoose";
import { pino } from "pino";

const logger = pino({ name: "mongo" });

export async function connectMongo(uri: string, dbName: string): Promise<typeof mongoose> {
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
