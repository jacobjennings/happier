import { t } from '@/text';
import { readSessionLiveManagedSessionCountV1 } from '@happier-dev/protocol/sessions/follow/sessionManagerV1';
import { readSessionRolesV1 } from '@happier-dev/protocol/prompts/roles/sessionRolesSnapshot';
import { resolveRoleSelectionV1 } from '@happier-dev/protocol/prompts/roles/resolveRoleSelectionV1';
import { readSessionPresentationAgentId } from '@/sync/domains/session/presentation/readSessionPresentationAgentId';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { readSessionPresentationRecord, readSessionPresentationServerId, readSessionPresentationInputSource, readSessionPresentationInputDisplay,
    readSessionListPresentationOwnerMetadataField, type SessionRelationRecord } from '@/sync/domains/session/listing/sessionListRenderableSessionProjection';
import { readSessionFullPublicationUpdatedAt } from '@/sync/domains/session/sessionRuntimeObservation';

export type PutUnderCandidatePresentation = Readonly<{
    agentId: string | null;
    roleId: string | null;
    roleName: string | null;
    /** Unknown counts stay unknown; never reconstruct reports by scanning the Session list. */
    leadsCount: number | null;
    workingCount: number | null;
    updatedAt: number;
}>;

/** Candidate facts come only from the already-held Session and its server Work projection. */
export function readPutUnderCandidatePresentation(input: SessionRelationRecord): PutUnderCandidatePresentation {
    const session = readSessionPresentationRecord(input);
    const source = readSessionPresentationInputSource(input);
    const roles = readSessionRolesV1(source ? { work: readSessionListPresentationOwnerMetadataField(source, 'work') }
        : 'agentState' in session ? readSessionOwnerMetadataView(session) : null);
    const roleId = roles?.roleId ?? null;
    const reports = source ? source.relations.managedSessions : session.managedSessions;
    const role = roleId && roles ? resolveRoleSelectionV1({ roleId, sessionRoles: roles }) : null;
    return {
        agentId: readSessionPresentationAgentId(readSessionPresentationInputDisplay(input)),
        roleId,
        roleName: role?.ok ? role.selection.name : null,
        leadsCount: reports ? readSessionLiveManagedSessionCountV1(reports) : null,
        workingCount: reports?.working ?? null,
        updatedAt: readSessionFullPublicationUpdatedAt({ id: session.id,
            serverId: readSessionPresentationServerId(input), updatedAt: source?.lifecycle.updatedAt ?? session.updatedAt }),
    };
}

/** A definite refusal means the attempted relation was not committed. */
export function isManagerRefusal(errorCode: string | undefined): boolean {
    return errorCode !== undefined && ['manager_cycle', 'manager_cas_conflict', 'manager_forbidden', 'credential_scope_denied'].includes(errorCode);
}

/** Shared words for an authoritative manager refusal. */
export function describeManagerRefusal(errorCode: string | undefined): string {
    switch (errorCode) {
        case 'manager_cycle': return t('sessionWork.putUnder.errors.cycle');
        case 'manager_cas_conflict': return t('sessionWork.putUnder.errors.changed');
        case 'manager_forbidden':
        case 'credential_scope_denied': return t('sessionWork.putUnder.errors.forbidden');
        default: return t('sessionWork.putUnder.errors.failed');
    }
}
