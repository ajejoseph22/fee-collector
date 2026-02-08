import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
	HOST: z.string().min(1).default("localhost"),
	PORT: z.coerce.number().int().positive().default(8080),
	CORS_ORIGIN: z.string().url().default("http://localhost:8080"),

	// Rate Limiter
	COMMON_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(1000),
	COMMON_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(1000),

	// MongoDB
	MONGO_URI: z.string().min(1).default("mongodb://localhost:27017"),
	MONGO_DB: z.string().min(1).default("fee-consolidation"),

	// Fee Collector — Polygon
	FEE_COLLECTOR_POLYGON_RPC: z.string().url().default("https://polygon-rpc.com"),
	FEE_COLLECTOR_POLYGON_ADDRESS: z
		.string()
		.min(1)
		.default("0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9"),

	// Fee Collector — sync settings
	FEE_COLLECTOR_START_BLOCK: z.coerce.number().int().nonnegative().default(78600000),
	FEE_COLLECTOR_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(20),
	FEE_COLLECTOR_BATCH_SIZE: z.coerce.number().int().positive().default(2000),
	FEE_COLLECTOR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
	FEE_COLLECTOR_REORG_BACKTRACK: z.coerce.number().int().positive().default(200),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
	console.error("❌ Invalid environment variables:", parsedEnv.error.format());
	throw new Error("Invalid environment variables");
}

export const env = {
	...parsedEnv.data,
	isDevelopment: parsedEnv.data.NODE_ENV === "development",
	isProduction: parsedEnv.data.NODE_ENV === "production",
	isTest: parsedEnv.data.NODE_ENV === "test",
};
