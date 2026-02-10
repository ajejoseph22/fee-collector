import { getModelForClass, index, modelOptions, prop } from "@typegoose/typegoose";

// Unique index cus we want to keep one record (state) per chain
@index({ chainId: 1 }, { unique: true })
@modelOptions({
	schemaOptions: {
		timestamps: { createdAt: false, updatedAt: true },
		collection: "chain_sync_states",
	},
})
export class ChainSyncState {
	@prop({ required: true, type: Number })
	public chainId!: number;

	@prop({ required: true, type: Number })
	public lastProcessedBlock!: number;

	@prop({ required: true, type: String })
	public lastProcessedBlockHash!: string;

	public updatedAt!: Date;
}

export const ChainSyncStateModel = getModelForClass(ChainSyncState);
