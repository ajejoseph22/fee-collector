import { ChainWorkerLockModel } from "@/fee-collector/models/chain-worker-lock";

function isDuplicateKeyError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && (error as { code?: number }).code === 11000);
}

export async function acquireChainLock(chainId: number, ownerId: string, ttlMs: number): Promise<boolean> {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + ttlMs);

	try {
		await ChainWorkerLockModel.create({ chainId, ownerId, expiresAt });
		return true;
	} catch (error) {
		if (!isDuplicateKeyError(error)) {
			throw error;
		}

		const result = await ChainWorkerLockModel.updateOne(
			{
				chainId,
				$or: [{ ownerId }, { expiresAt: { $lte: now } }],
			},
			{ $set: { ownerId, expiresAt } },
		).exec();

		return result.matchedCount === 1;
	}
}

export async function renewChainLock(chainId: number, ownerId: string, ttlMs: number): Promise<boolean> {
	const expiresAt = new Date(Date.now() + ttlMs);
	const result = await ChainWorkerLockModel.updateOne(
		{ chainId, ownerId },
		{ $set: { expiresAt } },
	).exec();

	return result.matchedCount === 1;
}

export async function releaseChainLock(chainId: number, ownerId: string): Promise<void> {
	await ChainWorkerLockModel.deleteOne({ chainId, ownerId }).exec();
}
