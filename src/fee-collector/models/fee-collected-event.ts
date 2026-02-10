import { getModelForClass, index, modelOptions, prop } from "@typegoose/typegoose";

// Unique index ensures the same event can never be inserted
// twice even if a block range is re-scanned.
@index({ chainId: 1, txHash: 1, logIndex: 1 }, { unique: true })
// Query index for the REST API to efficiently fetch all events for a given integrator and chain
@index({ integrator: 1, chainId: 1, blockNumber: 1 })
@modelOptions({
	schemaOptions: {
		timestamps: { createdAt: true, updatedAt: false },
		collection: "fee_collected_events",
	},
})
export class FeeCollectedEvent {
	@prop({ required: true })
	public chainId!: number;

	@prop({ required: true })
	public blockNumber!: number;

	@prop({ required: true })
	public blockHash!: string;

	@prop({ required: true })
	public txHash!: string;

	@prop({ required: true })
	public logIndex!: number;

	/** EVM address of the collected token (lowercase). */
	@prop({ required: true })
	public token!: string;

	/** EVM address of the integrator (lowercase). */
	@prop({ required: true })
	public integrator!: string;

	/** Integrator fee share — stored as a string for BigNumber precision safety. */
	@prop({ required: true })
	public integratorFee!: string;

	/** LI.FI fee share — stored as a string for BigNumber precision safety. */
	@prop({ required: true })
	public lifiFee!: string;

	/** Block timestamp as a unix epoch (seconds). */
	@prop({ required: true })
	public blockTimestamp!: number;

	public createdAt!: Date;
}

export const FeeCollectedEventModel = getModelForClass(FeeCollectedEvent);
