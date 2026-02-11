import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { StatusCodes } from "http-status-codes";
import { pino } from "pino";

import { FeeController } from "@/api/fee/fee.controller";
import { FeeErrorSchema, FeeEventListSchema, FeeEventSchema, GetFeesSchema } from "@/api/fee/fee.model";
import { FeeRepository } from "@/api/fee/fee.repository";
import { FeeService } from "@/api/fee/fee.service";

export const feeRegistry = new OpenAPIRegistry();

feeRegistry.register("FeeEvent", FeeEventSchema);
feeRegistry.registerPath({
	method: "get",
	path: "/fees",
	tags: ["Fees"],
	request: {
		query: GetFeesSchema.shape.query,
	},
	responses: {
		[StatusCodes.OK]: {
			description: "Success",
			content: {
				"application/json": {
					schema: FeeEventListSchema,
				},
			},
		},
		[StatusCodes.BAD_REQUEST]: {
			description: "Bad Request",
			content: {
				"application/json": {
					schema: FeeErrorSchema,
				},
			},
		},
		[StatusCodes.INTERNAL_SERVER_ERROR]: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: FeeErrorSchema,
				},
			},
		},
	},
});

export const feeRepository = new FeeRepository();
export const feeService = new FeeService(feeRepository, pino({ name: "fees-service" }));
export const feeController = new FeeController(feeService);

function createFeeRouter(): Router {
	const router = express.Router();
	router.get("/", feeController.getFees);
	return router;
}

export const feeRouter = createFeeRouter();
