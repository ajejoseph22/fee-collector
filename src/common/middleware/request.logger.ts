import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import pino from "pino";
import pinoHttp from "pino-http";

import { env } from "@/common/utils/env.config";
import { prettyTransport } from "@/common/utils/logger";

const logger = pino({
	level: env.isProduction ? "info" : "debug",
	transport: env.isProduction ? undefined : prettyTransport(),
});

const getLogLevel = (status: number) => {
	if (status >= StatusCodes.INTERNAL_SERVER_ERROR) return "error";
	if (status >= StatusCodes.BAD_REQUEST) return "warn";
	return "info";
};

const addRequestId = (req: Request, res: Response, next: NextFunction) => {
	const existingId = req.headers["x-request-id"] as string;
	const requestId = existingId || randomUUID();

	// Set for downstream use
	req.headers["x-request-id"] = requestId;
	res.setHeader("X-Request-Id", requestId);

	next();
};

const httpLogger = pinoHttp({
	logger,
	genReqId: (req) => req.headers["x-request-id"] as string,
	customLogLevel: (_req, res) => getLogLevel(res.statusCode),
	customSuccessMessage: (req) => `${req.method} ${req.url} completed`,
	customErrorMessage: (_req, res) => `Request failed with status code: ${res.statusCode}`,
	serializers: {
		req: (req) => ({
			method: req.method,
			url: req.url,
			id: req.id,
		}),
		...(env.isProduction && {
			res: (res) => ({
				statusCode: res.statusCode,
			}),
		}),
	},
});

export default [addRequestId, httpLogger];
