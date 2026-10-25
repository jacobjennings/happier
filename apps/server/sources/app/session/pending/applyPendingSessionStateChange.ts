import { markPendingStateChangedParticipants } from "@/app/session/pending/markPendingStateChangedParticipants";
import type { SessionParticipantCursor } from "@/app/session/changeTracking/markSessionParticipantsChanged";
import type { Tx } from "@/storage/inTx";
import { didSessionActivityBadgeContributionChange } from "@/app/activity/accountActivityBadge";

export async function applyPendingSessionStateChange(params: {
    tx: Tx;
    sessionId: string;
    pendingCountDelta?: number;
    pendingOwnerCountDelta?: number;
    pendingBlockedCountDelta?: number;
    meaningfulActivityAt?: Date;
    activationTarget?: Readonly<{ accountId: string; requestId: string }>;
}): Promise<{ pendingOwnerCount: number; pendingCount: number; pendingBlockedCount: number; pendingVersion: number; participantCursors: SessionParticipantCursor[]; badgeAttentionChanged: boolean }> {
    const { tx, sessionId } = params;
    const pendingCountDelta = typeof params.pendingCountDelta === "number" && Number.isInteger(params.pendingCountDelta)
        ? params.pendingCountDelta
        : 0;
    const pendingOwnerCountDelta = typeof params.pendingOwnerCountDelta === "number" && Number.isInteger(params.pendingOwnerCountDelta)
        ? params.pendingOwnerCountDelta
        : 0;
    const pendingBlockedCountDelta = typeof params.pendingBlockedCountDelta === "number" && Number.isInteger(params.pendingBlockedCountDelta)
        ? params.pendingBlockedCountDelta
        : 0;
    const before = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
            seq: true,
            pendingOwnerCount: true,
            pendingCount: true,
            pendingBlockedCount: true,
            pendingVersion: true,
            lastViewedSessionSeq: true,
            pendingPermissionRequestCount: true,
            pendingUserActionRequestCount: true,
            active: true,
            archivedAt: true,
        },
    });
    const baseData: {
        pendingVersion: { increment: 1 };
        meaningfulActivityAt?: Date;
    } = {
        pendingVersion: { increment: 1 },
    };
    if (params.meaningfulActivityAt instanceof Date && Number.isFinite(params.meaningfulActivityAt.getTime())) {
        baseData.meaningfulActivityAt = params.meaningfulActivityAt;
    }

    const session = await applyPendingCounterUpdate({
        tx,
        sessionId,
        pendingCountDelta,
        pendingOwnerCountDelta,
        pendingBlockedCountDelta,
        data: baseData,
        initialState: {
            pendingOwnerCount: before.pendingOwnerCount,
            pendingCount: before.pendingCount,
            pendingBlockedCount: before.pendingBlockedCount,
            pendingVersion: before.pendingVersion,
        },
    });

    const participantCursors = await markPendingStateChangedParticipants({
        tx,
        sessionId,
        pendingVersion: session.pendingVersion,
        pendingOwnerCount: session.pendingOwnerCount,
        pendingCount: session.pendingCount,
        pendingBlockedCount: session.pendingBlockedCount,
        meaningfulActivityAt: params.meaningfulActivityAt,
        activationTarget: params.activationTarget,
    });

    return {
        pendingOwnerCount: session.pendingOwnerCount,
        pendingCount: session.pendingCount,
        pendingBlockedCount: session.pendingBlockedCount,
        pendingVersion: session.pendingVersion,
        participantCursors,
        badgeAttentionChanged: didSessionActivityBadgeContributionChange(before, {
            ...before,
            pendingOwnerCount: session.pendingOwnerCount,
            pendingCount: session.pendingCount,
            pendingBlockedCount: session.pendingBlockedCount,
        }),
    };
}

type PendingCounterState = {
    pendingOwnerCount: number;
    pendingCount: number;
    pendingBlockedCount: number;
    pendingVersion: number;
};

async function applyPendingCounterUpdate(params: {
    tx: Tx;
    sessionId: string;
    pendingCountDelta: number;
    pendingOwnerCountDelta: number;
    pendingBlockedCountDelta: number;
    data: {
        pendingVersion: { increment: 1 };
        meaningfulActivityAt?: Date;
    };
    initialState: PendingCounterState;
}): Promise<PendingCounterState> {
    let current = params.initialState;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const nextPendingOwnerCount = Math.max(0, current.pendingOwnerCount + params.pendingOwnerCountDelta);
        const nextPendingCount = Math.max(0, current.pendingCount + params.pendingCountDelta);
        const nextPendingBlockedCount = Math.max(0, current.pendingBlockedCount + params.pendingBlockedCountDelta);
        const updated = await params.tx.session.updateMany({
            where: {
                id: params.sessionId,
                pendingOwnerCount: current.pendingOwnerCount,
                pendingCount: current.pendingCount,
                pendingBlockedCount: current.pendingBlockedCount,
                pendingVersion: current.pendingVersion,
            },
            data: {
                ...params.data,
                pendingOwnerCount: nextPendingOwnerCount,
                pendingCount: nextPendingCount,
                pendingBlockedCount: nextPendingBlockedCount,
            },
        });

        if (updated.count > 0) {
            return params.tx.session.findUniqueOrThrow({
                where: { id: params.sessionId },
                select: { pendingOwnerCount: true, pendingCount: true, pendingBlockedCount: true, pendingVersion: true },
            });
        }

        current = await params.tx.session.findUniqueOrThrow({
            where: { id: params.sessionId },
            select: { pendingOwnerCount: true, pendingCount: true, pendingBlockedCount: true, pendingVersion: true },
        });
    }

    const nextPendingOwnerCount = Math.max(0, current.pendingOwnerCount + params.pendingOwnerCountDelta);
    const nextPendingCount = Math.max(0, current.pendingCount + params.pendingCountDelta);
    const nextPendingBlockedCount = Math.max(0, current.pendingBlockedCount + params.pendingBlockedCountDelta);
    return params.tx.session.update({
        where: { id: params.sessionId },
        data: {
            ...params.data,
            pendingOwnerCount: nextPendingOwnerCount,
            pendingCount: nextPendingCount,
            pendingBlockedCount: nextPendingBlockedCount,
        },
        select: { pendingOwnerCount: true, pendingCount: true, pendingBlockedCount: true, pendingVersion: true },
    });
}
