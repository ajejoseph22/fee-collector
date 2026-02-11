import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pino } from "pino";
import { feeRouter } from "@/api/fee/fee.router";
import { healthCheckRouter } from "@/api/health-check/health-check.router";
import { openAPIRouter } from "@/api-docs/open-api.router";
import errorHandler from "@/common/middleware/error.handler";
import rateLimiter from "@/common/middleware/rate.limiter";
import requestLogger from "@/common/middleware/request.logger";
import { env } from "@/common/utils/env.config";

const logger = pino({ name: "server start" });
const app: Express = express();

// Set the application to trust the reverse proxy
app.set("trust proxy", true);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(helmet());
app.use(rateLimiter);

// Request logging
app.use(requestLogger);

// Routes
app.use("/health-check", healthCheckRouter);
app.use("/fees", feeRouter);

// Swagger UI
app.use(openAPIRouter);

// Error handlers
app.use(errorHandler());

export { app, logger };
