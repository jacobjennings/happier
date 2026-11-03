import type { ActivitySurfacePolicy } from '@/activity/attention/resolveActivitySurfacePolicy';
import type { ActivitySurfaceCandidatePrivacyModeResolver } from '@/activity/presentation/buildActivitySurfaceViewModel';
import type { ActivityOverviewSnapshot } from '@/activity/attention/activityAttentionTypes';
import type { SessionPresentationRecord as Session } from '@/sync/domains/session/listing/sessionListRenderableSessionProjection';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';

import { buildLiveActivitySnapshots, type LiveActivitySnapshot } from './buildLiveActivitySnapshots';

const LIVE_ACTIVITY_DYNAMIC_PRIMARY_DWELL_MS = 90_000;

export type LiveActivityReconciliationState = Readonly<{
    snapshots: readonly LiveActivitySnapshot[];
    preferredPrimaryAddress: SessionAddress | null;
    preferredPrimaryActivityInstanceKey: string | null;
    preferredPrimaryChangedAtMs: number | null;
}>;

export function resolveLiveActivityReconciliationState(params: Readonly<{
    sessions: readonly Session[];
    overview?: ActivityOverviewSnapshot;
    policy: ActivitySurfacePolicy;
    currentPreferredPrimaryAddress?: SessionAddress | null;
    currentPreferredPrimaryActivityInstanceKey?: string | null;
    currentPreferredPrimaryChangedAtMs?: number | null;
    dwellMs?: number;
    staleAfterMs?: number;
    nowMs?: number;
    resolveCandidatePrivacyMode?: ActivitySurfaceCandidatePrivacyModeResolver;
}>): LiveActivityReconciliationState {
    const nowMs = params.nowMs ?? Date.now();
    const dwellMs = typeof params.dwellMs === 'number' && Number.isFinite(params.dwellMs)
        ? Math.max(0, params.dwellMs)
        : LIVE_ACTIVITY_DYNAMIC_PRIMARY_DWELL_MS;
    const rawSnapshots = buildLiveActivitySnapshots({
        sessions: params.sessions,
        overview: params.overview,
        policy: params.policy,
        preferredPrimaryAddress: params.currentPreferredPrimaryAddress ?? null,
        staleAfterMs: params.staleAfterMs,
        nowMs,
        resolveCandidatePrivacyMode: params.resolveCandidatePrivacyMode,
    });
    const currentKey = normalizeKey(params.currentPreferredPrimaryActivityInstanceKey);
    const currentChangedAtMs = typeof params.currentPreferredPrimaryChangedAtMs === 'number'
        ? params.currentPreferredPrimaryChangedAtMs
        : null;
    const shouldHoldDynamicPrimary =
        params.policy.liveActivities.strategy === 'dynamic_primary'
        && currentKey !== null
        && currentChangedAtMs !== null
        && nowMs - currentChangedAtMs < dwellMs;
    const snapshots = shouldHoldDynamicPrimary
        ? buildLiveActivitySnapshots({
            sessions: params.sessions,
            overview: params.overview,
            policy: params.policy,
            preferredPrimaryActivityInstanceKey: currentKey,
            staleAfterMs: params.staleAfterMs,
            nowMs,
            resolveCandidatePrivacyMode: params.resolveCandidatePrivacyMode,
        })
        : rawSnapshots;
    const preferredPrimaryActivityInstanceKey = snapshots[0]?.activityInstanceKey ?? null;
    const preferredPrimaryChangedAtMs = preferredPrimaryActivityInstanceKey === null
        ? null
        : preferredPrimaryActivityInstanceKey === currentKey && currentChangedAtMs !== null
            ? currentChangedAtMs
            : nowMs;

    return {
        snapshots,
        preferredPrimaryAddress: params.policy.liveActivities.strategy === 'pinned_primary' && snapshots[0]
            ? normalizeSessionAddress(snapshots[0].serverId, snapshots[0].sessionId)
            : null,
        preferredPrimaryActivityInstanceKey,
        preferredPrimaryChangedAtMs,
    };
}

function normalizeKey(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
}
