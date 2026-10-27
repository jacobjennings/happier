import { markPendingStateChangedRecipients } from "@/app/session/pending/markPendingStateChangedRecipients";
import type { SessionRecipientPublication } from "@/app/session/changeTracking/markSessionProjectionRecipientsChanged";
import type { Tx } from "@/storage/inTx";
import { didSessionActivityBadgeSignalChange } from "@/app/activity/accountActivityBadge";
import { SESSION_TRANSCRIPT_PUBLICATION_SELECT } from "@/app/session/sessionTranscriptPublicationPolicy";
import { acquireSessionAccountCursorLocksInTx } from "@/app/session/changeTracking/acquireSessionAccountCursorLocksInTx";

export async function applyPendingSessionStateChange(params: {
    tx: Tx;
    sessionId: string;
    pendingOwnerCountDelta?: number;
    pendingCountDelta?: number;
    pendingBlockedCountDelta?: number;
    meaningfulActivityAt?: Date;
    activationTarget?: Readonly<{ accountId: string; requestId: string }>;
}): Promise<{
    pendingOwnerCount: number;
    pendingCount: number;
    pendingBlockedCount: number;
    pendingVersion: number;
    recipientCursors: SessionRecipientPublication[];
    badgeAttentionChanged: boolean;
    meaningfulActivityAt?: Date;
}> {
    const { tx, sessionId, meaningfulActivityAt } = params;
    await acquireSessionAccountCursorLocksInTx(tx, [sessionId]);
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
            ...SESSION_TRANSCRIPT_PUBLICATION_SELECT,
            pendingOwnerCount: true,
            pendingCount: true,
            pendingBlockedCount: true,
            pendingVersion: true,
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
    if (meaningfulActivityAt instanceof Date && Number.isFinite(meaningfulActivityAt.getTime())) {
        baseData.meaningfulActivityAt = meaningfulActivityAt;
    }

    const session = await applyPendingCounterUpdate({
        tx,
        sessionId,
        pendingOwnerCountDelta,
        pendingCountDelta,
        pendingBlockedCountDelta,
        data: baseData,
        initialState: {
            pendingOwnerCount: before.pendingOwnerCount,
            pendingCount: before.pendingCount,
            pendingBlockedCount: before.pendingBlockedCount,
            pendingVersion: before.pendingVersion,
        },
    });

    const recipientCursors = await markPendingStateChangedRecipients({
        tx,
        sessionId,
        pendingVersion: session.pendingVersion,
        pendingOwnerCount: session.pendingOwnerCount,
        pendingCount: session.pendingCount,
        pendingBlockedCount: session.pendingBlockedCount,
        meaningfulActivityAt,
        activationTarget: params.activationTarget,
    });

    return {
        pendingOwnerCount: session.pendingOwnerCount,
        pendingCount: session.pendingCount,
        pendingBlockedCount: session.pendingBlockedCount,
        pendingVersion: session.pendingVersion,
        recipientCursors,
        badgeAttentionChanged: didSessionActivityBadgeSignalChange(before, {
            ...before,
            pendingOwnerCount: session.pendingOwnerCount,
            pendingCount: session.pendingCount,
            pendingBlockedCount: session.pendingBlockedCount,
        }),
        ...(meaningfulActivityAt instanceof Date && Number.isFinite(meaningfulActivityAt.getTime())
            ? { meaningfulActivityAt }
            : {}),
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
    pendingOwnerCountDelta: number;
    pendingCountDelta: number;
    pendingBlockedCountDelta: number;
    data: {
        pendingVersion: { increment: 1 };
        meaningfulActivityAt?: Date;
    };
    initialState: PendingCounterState;
}): Promise<PendingCounterState> {
    let current = params.initialState;
    let pendingOwnerCountDelta = params.pendingOwnerCountDelta;
    let pendingCountDelta = params.pendingCountDelta;
    let pendingBlockedCountDelta = params.pendingBlockedCountDelta;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const nextPendingOwnerCount = Math.max(0, current.pendingOwnerCount + pendingOwnerCountDelta);
        const nextPendingCount = Math.max(0, current.pendingCount + pendingCountDelta);
        const nextPendingBlockedCount = Math.max(0, current.pendingBlockedCount + pendingBlockedCountDelta);
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
        if (params.initialState.pendingOwnerCount <= 0 && params.pendingOwnerCountDelta < 0) {
            pendingOwnerCountDelta = 0;
        }
        if (params.initialState.pendingCount <= 0 && params.pendingCountDelta < 0) {
            pendingCountDelta = 0;
        }
        if (params.initialState.pendingBlockedCount <= 0 && params.pendingBlockedCountDelta < 0) {
            pendingBlockedCountDelta = 0;
        }
    }

    const nextPendingOwnerCount = Math.max(0, current.pendingOwnerCount + pendingOwnerCountDelta);
    const nextPendingCount = Math.max(0, current.pendingCount + pendingCountDelta);
    const nextPendingBlockedCount = Math.max(0, current.pendingBlockedCount + pendingBlockedCountDelta);
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
