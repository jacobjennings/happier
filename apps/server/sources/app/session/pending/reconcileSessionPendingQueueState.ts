import { inTx, type Tx } from "@/storage/inTx";

export type ReconciledSessionPendingQueueState = Readonly<{
    pendingOwnerCount: number;
    pendingCount: number;
    pendingBlockedCount: number;
    pendingVersion: number;
    didRepair: boolean;
}>;

type PendingStateInput = Readonly<{
    sessionId: string;
    pendingOwnerCount?: number;
    pendingCount: number;
    pendingBlockedCount?: number;
    pendingVersion: number;
}>;

export async function reconcileSessionPendingQueueState(
    params: PendingStateInput,
): Promise<ReconciledSessionPendingQueueState> {
    return await inTx(async (tx) => await reconcileSessionPendingQueueStateInTx(tx, params.sessionId));
}

export async function reconcileSessionPendingQueueStateInTx(
    tx: Tx,
    sessionId: string,
): Promise<ReconciledSessionPendingQueueState> {
    const pendingCount = await tx.sessionPendingMessage.count({
        where: { sessionId, status: "queued" },
    });
    const pendingOwnerCount = await tx.sessionPendingMessage.count({
        where: { sessionId, status: "queued", automated: false },
    });
    const blockedCount = await tx.sessionPendingMessage.count({
        where: { sessionId, status: "queued", deliveryState: "blocked" },
    });

    const current = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: { pendingOwnerCount: true, pendingCount: true, pendingBlockedCount: true, pendingVersion: true },
    });

    if (pendingOwnerCount === current.pendingOwnerCount && pendingCount === current.pendingCount && blockedCount === current.pendingBlockedCount) {
        return {
            pendingOwnerCount: current.pendingOwnerCount,
            pendingCount: current.pendingCount,
            pendingBlockedCount: current.pendingBlockedCount,
            pendingVersion: current.pendingVersion,
            didRepair: false,
        };
    }

    const repair = await tx.session.updateMany({
        where: {
            id: sessionId,
            pendingOwnerCount: current.pendingOwnerCount,
            pendingCount: current.pendingCount,
            pendingBlockedCount: current.pendingBlockedCount,
            pendingVersion: current.pendingVersion,
        },
        data: { pendingOwnerCount, pendingCount, pendingBlockedCount: blockedCount, pendingVersion: { increment: 1 } },
    });

    if (repair.count <= 0) {
        const latest = await tx.session.findUniqueOrThrow({
            where: { id: sessionId },
            select: { pendingOwnerCount: true, pendingCount: true, pendingBlockedCount: true, pendingVersion: true },
        });

        return {
            pendingOwnerCount: latest.pendingOwnerCount,
            pendingCount: latest.pendingCount,
            pendingBlockedCount: latest.pendingBlockedCount,
            pendingVersion: latest.pendingVersion,
            didRepair: false,
        };
    }

    const repaired = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: { pendingOwnerCount: true, pendingCount: true, pendingBlockedCount: true, pendingVersion: true },
    });

    return {
        pendingOwnerCount: repaired.pendingOwnerCount,
        pendingCount: repaired.pendingCount,
        pendingBlockedCount: repaired.pendingBlockedCount,
        pendingVersion: repaired.pendingVersion,
        didRepair: true,
    };
}
