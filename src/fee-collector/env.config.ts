import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),

	// MongoDB
	MONGO_URI: z.string().min(1).default("mongodb://localhost:27017"),
	MONGO_DB: z.string().min(1).default("fee-consolidation"),

	// Polygon
	FEE_COLLECTOR_POLYGON_RPC: z.string().url().default("https://polygon-rpc.com"),
	FEE_COLLECTOR_POLYGON_ADDRESS: z
		.string()
		.min(1)
		.default("0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9"),
	FEE_COLLECTOR_POLYGON_START_BLOCK: z.coerce.number().int().nonnegative().default(78600000),
	FEE_COLLECTOR_POLYGON_REORG_BACKTRACK: z.coerce.number().int().positive().default(200),

	// Ethereum (POC, not tested)
	FEE_COLLECTOR_ETHEREUM_RPC: z.string().url().default("https://ethereum-rpc.publicnode.com"),
	FEE_COLLECTOR_ETHEREUM_ADDRESS: z
		.string()
		.min(1)
		.default("0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9"),
	FEE_COLLECTOR_ETHEREUM_START_BLOCK: z.coerce.number().int().nonnegative().default(18500000),
	FEE_COLLECTOR_ETHEREUM_REORG_BACKTRACK: z.coerce.number().int().positive().default(64),

	// Sync settings (shared across all chains)
	FEE_COLLECTOR_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(20),
	FEE_COLLECTOR_BATCH_SIZE: z.coerce.number().int().positive().default(10),
	FEE_COLLECTOR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
	FEE_COLLECTOR_BATCH_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
	FEE_COLLECTOR_LOCK_TTL_MS: z.coerce.number().int().positive().default(1800000),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
	console.error("Invalid fee-collector environment variables:", parsedEnv.error.format());
	throw new Error("Invalid fee-collector environment variables");
}

export const env = parsedEnv.data;
