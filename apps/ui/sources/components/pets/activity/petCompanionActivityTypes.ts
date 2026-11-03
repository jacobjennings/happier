import type { PetAnimationStateV1 } from '@happier-dev/protocol';

import type { SessionRelationRecord } from '@/sync/domains/session/listing/sessionListRenderableSessionProjection';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import type { SessionContextPresentation } from '@/sync/domains/session/presentation/sessionContextPresentation';

export type PetCompanionActivityStatus =
    Extract<PetAnimationStateV1, 'waiting' | 'failed' | 'review' | 'running' | 'idle'>;

export type PetCompanionActivityReason = PetCompanionActivityStatus;

export type PetCompanionSessionSignals = Readonly<{
    hasFailure: boolean;
    hasPendingPermissionRequests?: boolean;
    hasPendingUserActionRequests?: boolean;
    hasUnreadMessages: boolean;
    latestThinkingActivityAtMs: number | null;
    latestMeaningfulActivityAtMs: number | null;
    lastMessageSubtitle?: string | null;
    pendingMessageCount: number;
}>;

export type PetCompanionTrayItem = Readonly<{
    id: string;
    dismissKey: string;
    address: SessionAddress;
    sessionId: string;
    contextLine: string | null;
    /** The canonical privacy-filtered structural context for assistive technology. */
    accessibilityContext: string | null;
    status: Exclude<PetCompanionActivityStatus, 'idle'>;
    priority: number;
    title: string;
    subtitle: string | null;
    activityAtMs: number | null;
    expiresAtMs: number | null;
    actions: Readonly<{
        open: true;
        dismiss: true;
        quickReply: true;
    }>;
}>;

export type PetCompanionActivityModel = Readonly<{
    state: PetCompanionActivityStatus;
    reason: PetCompanionActivityReason;
    address: SessionAddress | null;
    sessionId: string | null;
    trayItems: readonly PetCompanionTrayItem[];
}>;

export type BuildPetCompanionActivityModelInput = Readonly<{
    sessions: readonly SessionRelationRecord[];
    contextsByAddressKey?: Readonly<Record<string, SessionContextPresentation | null | undefined>>;
    selectedAddress?: SessionAddress | null;
    selectedSessionId?: string | null;
    signalsByAddressKey?: Readonly<Record<string, PetCompanionSessionSignals | undefined>>;
    signalsBySessionId?: Readonly<Record<string, PetCompanionSessionSignals | undefined>>;
    dismissedTrayItemKeys?: ReadonlySet<string> | readonly string[];
    nowMs?: number;
}>;
