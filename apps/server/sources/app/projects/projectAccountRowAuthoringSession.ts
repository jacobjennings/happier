import {
    ProjectAccountRowAuthoringSessionRequestV1Schema,
    buildProjectAccountRowPhysicalKeyV1,
    type ProjectAccountRowAuthoringSessionRequestV1,
    type ProjectAccountRowAuthoringSessionResponseV1,
    type ProjectAccountRowReadResponseV1,
} from '@happier-dev/protocol/projects/projectAccountRowsV1';
import { acquireAccountEncryptionTransitionFenceInTx } from '@/app/encryption/accountEncryptionTransition';
import { mutateReservedAccountScopedKvRowInTx } from '@/app/kv/reservedAccountScopedKvRow';
import { readUserKvMutationConflict } from '@/app/kv/kvMutate';
import { inReadSnapshot, inTx, transactionResult } from '@/storage/inTx';
import { markProjectAccountRowChangedInTx, readProjectAccountRowInTx } from './projectAccountRowService';
import { projectAccountRowStorageDomain } from './projectAccountRowStorage';

function settled(row: ProjectAccountRowReadResponseV1, session: ProjectAccountRowAuthoringSessionRequestV1['session']): ProjectAccountRowAuthoringSessionResponseV1 | null {
    if (row.status === 'absent' || row.status === 'deleted') return { status: 'absent' };
    if (row.status !== 'present') return row;
    return row.row.authoringSession?.serverId === session.serverId && row.row.authoringSession.sessionId === session.sessionId
        ? { status: 'recorded', row: row.row } : null;
}

/** Records only the accepted checkout's id relationship; equal retries perform no writes or publication. */
export async function recordProjectAccountRowAuthoringSession(input: Readonly<{ accountId: string; request: ProjectAccountRowAuthoringSessionRequestV1 }>): Promise<ProjectAccountRowAuthoringSessionResponseV1> {
    const parsed = ProjectAccountRowAuthoringSessionRequestV1Schema.safeParse(input.request);
    if (!parsed.success) return { status: 'invalid-request' };
    const { key, session } = parsed.data;
    const readInput = { accountId: input.accountId, key, includeAuthoringSession: true as const };
    // The SQLite write fence itself reserves a writer with a no-op UPDATE.
    // An already-recorded relationship needs only the canonical read snapshot.
    const existing = settled(await inReadSnapshot(tx => readProjectAccountRowInTx(tx, readInput)), session);
    if (existing) return existing;
    try {
        return await inTx(async tx => {
            const fence = await acquireAccountEncryptionTransitionFenceInTx(tx, input.accountId, 'content');
            if (fence.status === 'account_not_found') return { status: 'account-not-found' as const };
            if (fence.status === 'account_inconsistent') return { status: 'account-inconsistent' as const, reason: fence.reason };
            const current = await readProjectAccountRowInTx(tx, readInput);
            const currentSettlement = settled(current, session);
            if (currentSettlement) return currentSettlement;
            if (current.status !== 'present' || current.row.content === null) throw new Error('Authoring relation requires an admitted checkout');
            const result = await mutateReservedAccountScopedKvRowInTx(tx, {
                accountId: input.accountId, physicalKey: buildProjectAccountRowPhysicalKeyV1(key),
                expectedRevision: current.row.revision, envelope: { ...current.row.content, authoringSession: session },
                domain: projectAccountRowStorageDomain(key),
                markChanged: ({ tx, revision }) => markProjectAccountRowChangedInTx(tx, { accountId: input.accountId, key, revision }),
            });
            if (result.status === 'conflict') return { ...result, key };
            if (result.status !== 'updated') return result;
            return transactionResult(() => ({ status: 'recorded' as const, row: {
                ...current.row, revision: result.revision, authoringSession: session,
            } }));
        });
    } catch (error) {
        const conflict = await readUserKvMutationConflict(error);
        if (conflict && conflict.key === buildProjectAccountRowPhysicalKeyV1(key)) return { status: 'conflict', key, revision: conflict.version };
        throw error;
    }
}
