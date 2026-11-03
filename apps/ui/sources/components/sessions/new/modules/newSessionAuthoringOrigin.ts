import type { Metadata } from '@happier-dev/session-core/state';
import { PluginUiNewSessionSeedOriginV1Schema, type PluginUiNewSessionSeedOriginV1 } from '@happier-dev/protocol/plugins/ui';
import { SessionOwnerMetadataV1Schema, readSessionMetadataMutationFailureCodeV1 } from '@happier-dev/protocol/sessions/metadata/sessionMetadataSchemasV1';
import { PROJECT_ACCOUNT_ROWS_ROUTE_V1, ProjectAccountRowAuthoringSessionRequestV1Schema, ProjectAccountRowAuthoringSessionResponseV1Schema } from '@happier-dev/protocol/projects/projectAccountRowsV1';
import { captureLazyActionAccountContext } from '@/sync/ops/actions/actionAccountContext';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { log } from '@/log';
import { fetchSessionByIdWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/fetchSessionByIdWithServerScope';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { stableJsonStringify } from '@/utils/json/stableJsonStringify';
import type { PersistedSpawnAttempt } from '@/sync/domains/session/spawn/spawnAttemptNonceStore';
import { readProjectSessionAuthoringOrigin } from '@/sync/domains/workspaces/readProjectSessionAuthoringOrigin';

type SessionAuthoringOriginPersistence = NonNullable<PersistedSpawnAttempt['authoringOriginPersistence']>;

/** A finite exact owner read proves the daemon's private write without entering CAS. */
async function confirmCreatedSessionAuthoringOrigin(params: Readonly<{
    sessionId: string; serverId: string; origin: PluginUiNewSessionSeedOriginV1; shouldContinue: () => boolean;
}>): Promise<void> {
    const account = await captureLazyActionAccountContext(params.serverId);
    try {
        account.assertCurrent();
        if (!params.shouldContinue()) throw Object.assign(new Error('Authoring origin continuation retired'), { code: 'continuation_retired' });
        const { accountMode, encryption } = await account.resolveAccountEncryption();
        let confirmed = false;
        await fetchSessionByIdWithServerScope({
            sessionId: params.sessionId, serverId: account.serverId, activeCredentials: account.credentials,
            activeEncryption: encryption, accountMode, activeRequest: account.request,
            sessionDataKeys: new Map(), sessionDataKeyEnvelopes: new Map(),
            includeTurnsProjection: false, isCurrent: () => account.accountLifetime.isCurrent() && params.shouldContinue(),
            applySessions: sessions => {
                const session = sessions.find(candidate => candidate.id === params.sessionId);
                const storedOrigin = session ? readProjectSessionAuthoringOrigin(readSessionOwnerMetadataView(session)) : null;
                confirmed = storedOrigin !== null && stableJsonStringify(storedOrigin) === stableJsonStringify(params.origin);
            },
            log,
        });
        account.assertCurrent();
        if (!confirmed || !params.shouldContinue()) throw Object.assign(new Error('Session birth authoring origin is unconfirmed'), {
            code: 'authoring_origin_birth_unconfirmed',
        });
    } finally { account.dispose(); }
}

/** The ordinary creation checkpoint retains private origin and records its id-only checkout relationship. */
export async function persistCreatedSessionAuthoringOrigin(params: Readonly<{
    sessionId: string;
    serverId: string;
    origin: PluginUiNewSessionSeedOriginV1;
    /** Unknown recovered custody can confirm, but must never select another writer. */
    originPersistence?: SessionAuthoringOriginPersistence | 'unknown';
    shouldContinue: () => boolean;
    updateSessionMetadataWithRetry: (
        sessionId: string,
        updater: (metadata: Metadata) => Metadata,
        options: Readonly<{ serverId: string; shouldContinue: () => boolean }>,
    ) => Promise<void>;
}>): Promise<void> {
    const origin = PluginUiNewSessionSeedOriginV1Schema.parse(params.origin);
    try {
        if (params.originPersistence === 'daemon-birth' || params.originPersistence === 'unknown') {
            await confirmCreatedSessionAuthoringOrigin({ ...params, origin });
        } else await params.updateSessionMetadataWithRetry(params.sessionId, (metadata) => {
            const work = SessionOwnerMetadataV1Schema.shape.work.parse(metadata.work);
            return { ...metadata, work: { ...work, authoringOriginV1: origin } };
        }, { serverId: params.serverId, shouldContinue: params.shouldContinue });
    } catch (cause) {
        // Keep the producer's error subtype/code/recovery fields for the incumbent presenter.
        const error = Object.assign(cause instanceof Error ? cause
            : new Error('Session authoring origin checkpoint failed', { cause }), { phase: 'authoring_origin' as const });
        // One terminal diagnostic, never a retry loop or owner content/error prose.
        log.log(`[SessionAuthoringOrigin] checkpoint_failed ${JSON.stringify({
            phase: error.phase, code: readSessionMetadataMutationFailureCodeV1(error),
            serverId: params.serverId, sessionId: params.sessionId,
        })}`);
        throw error;
    }
    if (origin.page !== 'scripts' || origin.purpose === 'session' || !params.shouldContinue()) return;
    // Device-local profile aliases cannot be interpreted by another client.
    const sessionHomeId = getServerProfileById(params.serverId)?.serverIdentityId;
    if (!sessionHomeId) return;
    const account = await captureLazyActionAccountContext(origin.workspace.serverId);
    try {
        account.assertCurrent();
        if (account.accountId !== origin.accountId || !params.shouldContinue()) return;
        const input = ProjectAccountRowAuthoringSessionRequestV1Schema.parse({
            key: { kind: 'workspace-ref', serverId: origin.workspace.serverId, id: origin.workspace.workspaceId },
            session: { serverId: sessionHomeId, sessionId: params.sessionId },
        });
        const response = await account.request(`${PROJECT_ACCOUNT_ROWS_ROUTE_V1}/authoring-session`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        });
        // A predecessor Home keeps the owner-private provenance written above.
        if (response.status === 404 || response.status === 405) return;
        if (!response.ok) throw new Error(`Project authoring relationship request failed (${response.status})`);
        const result = ProjectAccountRowAuthoringSessionResponseV1Schema.parse(await response.json());
        if (result.status !== 'recorded' && result.status !== 'absent') {
            throw Object.assign(new Error('Project authoring relationship was refused'), { code: `project_account_rows_${result.status}` });
        }
    } finally { account.dispose(); }
}
