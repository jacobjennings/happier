import type { WorkspaceAddressV1 } from '@happier-dev/protocol/workspaces/workspaceRefV1';
import {
    EMPTY_PROJECT_AUTHORING_SESSION_INPUTS,
    projectAuthoringCheckoutKey,
    type ProjectAuthoringSessionInputs,
} from './domains/projectAuthoringSessions';
import type { StorageState } from './types';
import { buildProjectAccountRowPhysicalKeyV1, type ProjectAccountAuthoringSessionV1 } from '@happier-dev/protocol/projects/projectAccountRowsV1';
import { workspaceAddressFromRefV1 } from '@happier-dev/protocol/workspaces/workspaceRefResolutionV1';
import { readCurrentProjectAccountRows } from '@/sync/domains/workspaces/projectAccountRows';
import { resolveWorkspaceRefByAddress } from '@/sync/domains/workspaces/workspaceRefs';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

const latestByInputs = new WeakMap<ProjectAuthoringSessionInputs, ReadonlyMap<string, ProjectAuthoringSessionInputs[string]>>();

/** The accepted checkout owns the id relationship; private Session metadata only supplies legacy discovery. */
export function selectProjectAuthoringSessionRelationship(
    state: Partial<Pick<StorageState, 'projectAccountRows' | 'profileScope'>>,
    workspace: WorkspaceAddressV1,
    accountId: string | null,
): ProjectAccountAuthoringSessionV1 | null {
    const rows = readCurrentProjectAccountRows({ projectAccountRows: state.projectAccountRows ?? null,
        ...('profileScope' in state ? { profileScope: state.profileScope } : {}) });
    if (!accountId || !rows || rows.scope.accountId !== accountId
        || !areServerProfileIdentifiersEquivalent(rows.scope.serverId, workspace.serverId)
        || rows.status === 'locked' || rows.status === 'refused') return null;
    // Reuse the census owner's existing index. Fixtures and retained snapshots may predate it.
    const indexed = rows.sessionProjectKeyResolver?.({ workspaceId: workspace.workspaceId }, workspace.serverId);
    const ref = indexed ? indexed.kind === 'resolved' ? indexed.ref : null
        : (() => { const found = resolveWorkspaceRefByAddress(rows.workspaceRefs, workspace); return found.kind === 'resolved' ? found.ref : null; })();
    if (!ref || projectAuthoringCheckoutKey(workspaceAddressFromRefV1(ref), accountId) !== projectAuthoringCheckoutKey(workspace, accountId)) return null;
    return rows.authoringSessionsByPhysicalKey?.[buildProjectAccountRowPhysicalKeyV1({ kind: 'workspace-ref', serverId: ref.serverId, id: ref.id })] ?? null;
}

/** The latest Session started from setup authoring for this exact checkout, as one primitive key. */
export function selectProjectLastAuthoringSessionId(
    state: Pick<StorageState, 'projectAuthoringSessions'> & Partial<Pick<StorageState, 'projectAccountRows' | 'profileScope'>>,
    workspace: WorkspaceAddressV1,
    accountId: string | null,
): string | null {
    if (!accountId) return null;
    const relationship = selectProjectAuthoringSessionRelationship(state, workspace, accountId);
    if (relationship) return relationship.sessionId;
    const checkoutKey = projectAuthoringCheckoutKey(workspace, accountId);
    if (!checkoutKey) return null;
    const inputs = state.projectAuthoringSessions ?? EMPTY_PROJECT_AUTHORING_SESSION_INPUTS;
    let latest = latestByInputs.get(inputs);
    if (!latest) {
        const candidates = new Map<string, ProjectAuthoringSessionInputs[string]>();
        for (const input of Object.values(inputs)) {
            const previous = candidates.get(input.checkoutKey);
            if (!previous || input.updatedAt > previous.updatedAt) candidates.set(input.checkoutKey, input);
        }
        latest = candidates;
        latestByInputs.set(inputs, latest);
    }
    return latest.get(checkoutKey)?.sessionId ?? null;
}
