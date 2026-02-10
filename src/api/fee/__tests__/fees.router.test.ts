import { StatusCodes } from "http-status-codes";
import request from "supertest";

import type { FeeEventList } from "@/api/fee/fee.model";
import { feeService } from "@/api/fee/fee.router";
import { app } from "@/server";

describe("Fees API Endpoints", () => {
	const integrator = "0x1111111111111111111111111111111111111111";

	it("GET /fees returns data for a valid request", async () => {
		const responseObject: FeeEventList = {
			data: [
				{
					chainId: 137,
					blockNumber: 78600000,
					blockHash: "0xabc",
					txHash: "0xdef",
					logIndex: 5,
					token: "0x2222222222222222222222222222222222222222",
					integrator,
					integratorFee: "100",
					lifiFee: "20",
					blockTimestamp: 1700000000,
				},
			],
			cursor: "cursor-1",
		};
		const findByIntegratorSpy = vi
			.spyOn(feeService, "findByIntegrator")
			.mockResolvedValue(responseObject);

		const response = await request(app).get("/fees").query({ integrator, chainId: "137", limit: "1" });

		expect(response.statusCode).toEqual(StatusCodes.OK);
		expect(response.body).toEqual(responseObject);
		expect(findByIntegratorSpy).toHaveBeenCalledWith(integrator.toLowerCase(), 137, undefined, 1);
	});

	it("GET /fees uses default limit and forwards cursor", async () => {
		const findByIntegratorSpy = vi
			.spyOn(feeService, "findByIntegrator")
			.mockResolvedValue({ data: [], cursor: null });
		const defaultLimit = 50

		const response = await request(app).get("/fees").query({ integrator, cursor: "opaque-cursor" });

		expect(response.statusCode).toEqual(StatusCodes.OK);
		expect(findByIntegratorSpy).toHaveBeenCalledWith(integrator.toLowerCase(), undefined, "opaque-cursor", defaultLimit);
	});

	it("GET /fees returns bad request for an invalid integrator", async () => {
		const findByIntegratorSpy = vi.spyOn(feeService, "findByIntegrator");

		const response = await request(app).get("/fees").query({ integrator: "not-an-address" });

		expect(response.statusCode).toEqual(StatusCodes.BAD_REQUEST);
		expect(response.body.error.code).toEqual("INVALID_REQUEST");
		expect(response.body.error.message).toContain("integrator");
		expect(findByIntegratorSpy).not.toHaveBeenCalled();
	});
});
