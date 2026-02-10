import type { Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { ZodError } from "zod";

import { GetFeesQuerySchema } from "@/api/fee/fee.model";
import { FeeServiceError, type FeeService } from "@/api/fee/fee.service";

function formatZodError(error: ZodError): string {
	return error.errors
		.map((issue) => {
			const path = issue.path.join(".");
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join("; ");
}

export class FeeController {
	constructor(private readonly feeService: FeeService) {}

	public getFees: RequestHandler = async (req: Request, res: Response) => {
		const parsedQuery = GetFeesQuerySchema.safeParse(req.query);
		if (!parsedQuery.success) {
			return res.status(StatusCodes.BAD_REQUEST).send({
				error: {
					code: "INVALID_REQUEST",
					message: formatZodError(parsedQuery.error),
				},
			});
		}

		try {
			const { integrator, chainId, cursor, limit } = parsedQuery.data;
			const feeEvents = await this.feeService.findByIntegrator(integrator, chainId, cursor, limit);
			return res.status(StatusCodes.OK).send(feeEvents);
		} catch (error) {
			if (error instanceof FeeServiceError) {
				return res.status(error.statusCode).send({
					error: {
						code: error.code,
						message: error.message,
					},
				});
			}

			return res.status(StatusCodes.INTERNAL_SERVER_ERROR).send({
				error: {
					code: "INTERNAL_ERROR",
					message: "An unexpected error occurred.",
				},
			});
		}
	};
}
