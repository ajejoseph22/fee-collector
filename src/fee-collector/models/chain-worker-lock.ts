import { getModelForClass, index, modelOptions, prop } from "@typegoose/typegoose";

@index({ chainId: 1 }, { unique: true })
@index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
@modelOptions({
	schemaOptions: {
		collection: "chain_worker_locks",
		timestamps: false,
	},
})
export class ChainWorkerLock {
	@prop({ required: true, type: Number })
	public chainId!: number;

	@prop({ required: true, type: String })
	public ownerId!: string;

	@prop({ required: true, type: Date })
	public expiresAt!: Date;
}

export const ChainWorkerLockModel = getModelForClass(ChainWorkerLock);
