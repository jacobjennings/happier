import type { ActivityOverviewSnapshot, SessionActivityAttention } from '@/activity/attention/activityAttentionTypes';
import type { ActivitySurfacePolicy } from '@/activity/attention/resolveActivitySurfacePolicy';
import { buildActivitySurfaceCountsViewModel } from '@/activity/presentation/buildActivitySurfaceCountsViewModel';
import {
    buildActivitySurfaceViewModels,
    resolvePrimaryActivitySurfaceTarget,
    type ActivitySurfaceCandidatePrivacyModeResolver,
} from '@/activity/presentation/buildActivitySurfaceViewModel';
import type { ActivitySurfaceSessionViewModel } from '@/activity/presentation/activitySurfaceViewModels';
import { resolveActivitySurfaceSlots } from '@/activity/selection/resolveActivitySurfaceSlots';
import { t } from '@/text';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import type { DesktopActivityOverlaySource } from '../runtime/useDesktopActivityOverlaySource';
import type { DesktopOverlayPolicy } from '../runtime/resolveDesktopOverlayPolicy';
import { resolveDesktopOverlaySelectionSpec } from '../runtime/resolveDesktopOverlaySelectionSpec';
import { buildDesktopActivityOverlayCompletionSnapshots } from './snapshot/buildDesktopActivityOverlayCompletionSnapshots';
import { buildDesktopActivityOverlayOverviewFromSource } from './snapshot/buildDesktopActivityOverlayOverviewFromSource';
import { buildDesktopActivityOverlayQuotaSummarySnapshots } from './snapshot/buildDesktopActivityOverlayQuotaSummarySnapshots';
import { buildDesktopActivityOverlayRequestSnapshots } from './snapshot/buildDesktopActivityOverlayRequestSnapshots';
import type {
    DesktopActivityOverlaySnapshot,
    DesktopActivityOverlaySnapshotLabels,
    DesktopActivityOverlaySessionSnapshot,
} from './snapshot/desktopActivityOverlaySnapshotTypes';

export type {
    DesktopActivityOverlayCompletionStateSnapshot,
    DesktopActivityOverlayQuotaSummarySnapshot,
    DesktopActivityOverlayRequestSnapshot,
    DesktopActivityOverlaySnapshot,
    DesktopActivityOverlaySnapshotLabels,
    DesktopActivityOverlaySnapshotState,
    DesktopActivityOverlaySessionSnapshot,
} from './snapshot/desktopActivityOverlaySnapshotTypes';

function buildDesktopActivityOverlaySnapshotLabels(): DesktopActivityOverlaySnapshotLabels {
    return {
        sessionsTitle: t('tabs.sessions'),
        emptyTitle: t('tabs.sessions'),
    };
}

function buildDesktopActivityOverlaySessionSnapshots(
    sessionViewModels: readonly ActivitySurfaceSessionViewModel[],
    candidates: readonly SessionActivityAttention[],
): readonly DesktopActivityOverlaySessionSnapshot[] {
    const candidateByAddress = new Map<string, SessionActivityAttention>();
    for (const candidate of candidates) {
        if (candidate.address) {
            candidateByAddress.set(sessionAddressKey(candidate.address), candidate);
        }
    }

    const resolveLegacyCandidate = (sessionId: string): SessionActivityAttention | undefined => {
        const matches = candidates.filter((candidate) => candidate.sessionId === sessionId);
        return matches.length === 1 ? matches[0] : undefined;
    };

    return sessionViewModels.map((viewModel) => {
        const candidate = viewModel.serverId
            ? candidateByAddress.get(sessionAddressKey({
                serverId: viewModel.serverId,
                sessionId: viewModel.sessionId,
            }))
            : resolveLegacyCandidate(viewModel.sessionId);
        return {
            sessionId: viewModel.sessionId,
            serverId: viewModel.serverId,
            title: viewModel.title,
            subtitle: viewModel.contextLine ?? viewModel.subtitle ?? null,
            statusText: viewModel.statusText ?? null,
            previewText: viewModel.previewText ?? null,
            attentionState: viewModel.attentionState,
            active: (candidate?.presentationSource?.lifecycle.active ?? candidate?.session.active) === true,
            updatedAt: viewModel.updatedAt,
        };
    });
}

export function buildDesktopActivityOverlaySnapshot(params: Readonly<{
    source: DesktopActivityOverlaySource;
    sourceOverview?: ActivityOverviewSnapshot;
    activityPolicy: ActivitySurfacePolicy;
    desktopPolicy: DesktopOverlayPolicy;
    previousPrimaryAddress?: SessionAddress | null;
    previousPrimaryChangedAtMs?: number | null;
    nowMs?: number;
    resolveCandidatePrivacyMode?: ActivitySurfaceCandidatePrivacyModeResolver;
}>): DesktopActivityOverlaySnapshot {
    const nowMs = params.nowMs ?? Date.now();
    const overview = params.sourceOverview ?? buildDesktopActivityOverlayOverviewFromSource({
        source: params.source,
        nowMs,
    });
    const selectionSpec = resolveDesktopOverlaySelectionSpec(params.desktopPolicy);
    const desktopTiming = overview.candidates[0]?.surfaceTiming?.desktopOverlay;
    const slots = resolveActivitySurfaceSlots({
        overview,
        selection: {
            ...selectionSpec,
            dwellMs: desktopTiming?.dwellMs ?? selectionSpec.dwellMs,
            staleAfterMs: desktopTiming?.staleAfterMs ?? selectionSpec.staleAfterMs,
        },
        previousPrimaryAddress: params.previousPrimaryAddress ?? null,
        previousPrimaryChangedAtMs: params.previousPrimaryChangedAtMs ?? null,
        nowMs,
    });
    const selectedSessions = buildActivitySurfaceViewModels({
        candidates: slots.selectedSessions,
        policy: params.activityPolicy,
        showMachinePath: true,
        showPreviewText: params.desktopPolicy.showPreviewText,
        nowMs,
        resolveCandidatePrivacyMode: params.resolveCandidatePrivacyMode,
    });
    const desktopSessions = buildDesktopActivityOverlaySessionSnapshots(
        selectedSessions,
        slots.selectedSessions,
    );
    const requestSnapshots = buildDesktopActivityOverlayRequestSnapshots({
        candidates: slots.selectedSessions,
        resolveCandidatePrivacyMode: params.resolveCandidatePrivacyMode,
    });
    const quotaSummaries = buildDesktopActivityOverlayQuotaSummarySnapshots(params.source.quotaSummaries);
    const completionStates = buildDesktopActivityOverlayCompletionSnapshots({
        candidates: slots.selectedSessions,
        sessionViewModels: selectedSessions,
        nowMs,
    });
    const state = slots.selectedSessions.length > 0 ? 'content' : 'idle';

    return {
        version: 1,
        generatedAt: nowMs,
        state,
        counts: overview.counts,
        summaryCounts: buildActivitySurfaceCountsViewModel(overview.counts),
        primary: desktopSessions[0] ?? null,
        sessions: desktopSessions,
        permissionRequests: requestSnapshots.permissionRequests,
        userQuestions: requestSnapshots.userQuestions,
        quotaSummaries,
        completionStates,
        defaultTarget: resolvePrimaryActivitySurfaceTarget(
            params.activityPolicy,
            desktopSessions[0]?.sessionId ?? null,
            desktopSessions[0]?.serverId ?? null,
        ),
        labels: buildDesktopActivityOverlaySnapshotLabels(),
    };
}
