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
	@prop({ required: true, type: Number })
	public chainId!: number;

	@prop({ required: true, type: Number })
	public blockNumber!: number;

	@prop({ required: true, type: String })
	public blockHash!: string;

	@prop({ required: true, type: String })
	public txHash!: string;

	@prop({ required: true, type: Number })
	public logIndex!: number;

	/** EVM address of the collected token (lowercase). */
	@prop({ required: true, type: String })
	public token!: string;

	/** EVM address of the integrator (lowercase). */
	@prop({ required: true, type: String })
	public integrator!: string;

	/** Integrator fee share — stored as a string for BigNumber precision safety. */
	@prop({ required: true, type: String })
	public integratorFee!: string;

	/** LI.FI fee share — stored as a string for BigNumber precision safety. */
	@prop({ required: true, type: String })
	public lifiFee!: string;

	/** Block timestamp as a unix epoch (seconds). */
	@prop({ required: true, type: Number })
	public blockTimestamp!: number;

	public createdAt!: Date;
}

export const FeeCollectedEventModel = getModelForClass(FeeCollectedEvent);
