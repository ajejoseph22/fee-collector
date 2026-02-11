import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Request, type Response, type Router } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";

export const healthCheckRegistry = new OpenAPIRegistry();
export const healthCheckRouter: Router = express.Router();

healthCheckRegistry.registerPath({
	method: "get",
	path: "/health-check",
	tags: ["Health Check"],
	responses: {
		[StatusCodes.OK]: {
			description: "Success",
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
		},
	},
});

healthCheckRouter.get("/", (_req: Request, res: Response) => {
	res.send({ message: "Service is healthy" });
});
