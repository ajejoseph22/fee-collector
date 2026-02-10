import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const FeeEventSchema = z.object({
	chainId: z.number(),
	blockNumber: z.number(),
	blockHash: z.string(),
	txHash: z.string(),
	logIndex: z.number(),
	token: z.string(),
	integrator: z.string(),
	integratorFee: z.string(),
	lifiFee: z.string(),
	blockTimestamp: z.number(),
});

export const FeeEventListSchema = z.object({
	data: z.array(FeeEventSchema),
	cursor: z.string().nullable(),
});

export const FeeErrorSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
	}),
});

export const GetFeesQuerySchema = z.object({
	integrator: z
		.string()
		.regex(/^0x[0-9a-fA-F]{40}$/, "Must be a valid EVM address")
		.transform((v) => v.toLowerCase()),
	chainId: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	cursor: z.string().min(1).optional(),
});

export const GetFeesSchema = z.object({
	query: GetFeesQuerySchema,
});

export type FeeEvent = z.infer<typeof FeeEventSchema>;
export type FeeEventList = z.infer<typeof FeeEventListSchema>;
export type FeeError = z.infer<typeof FeeErrorSchema>;
export type GetFeesQuery = z.infer<typeof GetFeesQuerySchema>;
