import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpcErrors';
import type { SessionSpawnNewInitialInputDispositionV1, SessionSpawnNewResultV1 } from '@happier-dev/protocol/sessions/creation/sessionSpawnNewResultV1';
import type { ActionOperationFailureV1 } from '@happier-dev/protocol/actions/operations/v1';
import { ApprovalStaleFailureDetailsSchema } from '@happier-dev/protocol/approvals/approvalRequestV1';

import { presentSessionStartupFailureCause } from '@/components/sessions/presentation/sessionRuntimeIssuePresentation';
import { t } from '@/text';
import type { SessionSpawnNewActionResult } from './sessionSpawnNewAction';

export type SessionSpawnNewActionFailurePresentation =
    | 'update_required'
    | 'generic_failure';

export type SessionSpawnNewActionFailureMessageKey =
    | 'newSession.actionMethodUnavailable'
    | 'newSession.failedToStart';

export type SessionSpawnNewResultFailureMessageKey =
    | 'connectedServices.diagnostics.body.connected_service_credential_reconnect_required'
    | 'connectedServices.diagnostics.body.connected_service_credential_refresh_unavailable'
    | 'newSession.launchStillPendingBody'
    | 'newSession.daemonRpcUnavailableBody'
    | 'session.access.repairBody'
    | 'session.access.preparationKeyUnavailable'
    | 'teams.policy.externalSharingDisabled'
    | 'teams.policy.externalSharingAdmins'
    | 'session.collaboration.accessUnavailableReason'
    | 'newSession.failedToStart';

/**
 * Keeps the strict creation callers on one typed compatibility presentation.
 * An older CLI can reject the Action method before it sees a spawn request;
 * that is distinct from an ordinary creation failure and never authorizes a
 * private-RPC retry.
 */
export function resolveSessionSpawnNewActionFailurePresentation(
    result: Extract<SessionSpawnNewActionResult, Readonly<{ ok: false }>>,
): SessionSpawnNewActionFailurePresentation {
    return result.errorCode === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE
        ? 'update_required'
        : 'generic_failure';
}

export function resolveSessionSpawnNewActionFailureMessageKey(
    result: Extract<SessionSpawnNewActionResult, Readonly<{ ok: false }>>,
): SessionSpawnNewActionFailureMessageKey {
    return resolveSessionSpawnNewActionFailurePresentation(result) === 'update_required'
        ? 'newSession.actionMethodUnavailable'
        : 'newSession.failedToStart';
}

/**
 * Projects the strict action result without discarding its originating typed
 * outcome. Only an explicit `machine_offline` result claims unavailable
 * daemon transport; a caller deadline is a neutral spawn failure.
 */
export function resolveSessionSpawnNewResultFailureMessageKey(
    result: Exclude<SessionSpawnNewResultV1, Readonly<{ type: 'success' }>>,
): SessionSpawnNewResultFailureMessageKey {
    if (result.type === 'pending') {
        return 'newSession.launchStillPendingBody';
    }
    if (result.code === 'spawn_failed' && result.launchError?.code === 'connected_service_credential_reconnect_required') {
        return 'connectedServices.diagnostics.body.connected_service_credential_reconnect_required';
    }
    if (result.code === 'spawn_failed' && result.launchError?.code === 'connected_service_credential_refresh_unavailable') {
        return 'connectedServices.diagnostics.body.connected_service_credential_refresh_unavailable';
    }
    if (
        result.code === 'recipient_key_unavailable'
        || result.code === 'session_access_invalid_recipient_envelope'
    ) {
        return 'session.access.repairBody';
    }
    if (result.code === 'session_data_key_unavailable') {
        return 'session.access.preparationKeyUnavailable';
    }
    if (result.code === 'session_access_external_sharing_disabled') {
        return 'teams.policy.externalSharingDisabled';
    }
    if (result.code === 'session_access_external_sharing_requires_team_admin') {
        return 'teams.policy.externalSharingAdmins';
    }
    if (result.code === 'session_access_sharing_unavailable') {
        return 'session.collaboration.accessUnavailableReason';
    }
    return result.code === 'machine_offline'
        ? 'newSession.daemonRpcUnavailableBody'
        : 'newSession.failedToStart';
}

/** Keep localized recovery guidance while exposing the typed cause of otherwise generic failures. */
export function resolveSessionSpawnNewActionFailureMessage(
    result: Extract<SessionSpawnNewActionResult, Readonly<{ ok: false }>>,
): string {
    const key = resolveSessionSpawnNewActionFailureMessageKey(result);
    const message = t(key);
    return key === 'newSession.failedToStart'
        ? t('errors.errorWithCode', { message, code: sessionSpawnFailureDisplayCode(result) })
        : message;
}

function sessionSpawnFailureDisplayCode(failure: Readonly<{ errorCode: string; details?: unknown }>): string {
    const stale = failure.errorCode === 'approval_stale' ? ApprovalStaleFailureDetailsSchema.safeParse(failure.details) : null;
    return stale?.success ? `${failure.errorCode}:${stale.data.reason}` : failure.errorCode;
}

export function resolveSessionSpawnNewResultFailureMessage(
    result: Exclude<SessionSpawnNewResultV1, Readonly<{ type: 'success' }>>,
): string {
    const key = resolveSessionSpawnNewResultFailureMessageKey(result);
    if (result.type !== 'pending' && (key === 'newSession.failedToStart'
        || key === 'connectedServices.diagnostics.body.connected_service_credential_reconnect_required')) {
        // A closed launch cause outranks the generic guidance; any other cause keeps the
        // outer code so no private detail reaches the person.
        const cause = result.code === 'spawn_failed' ? result.launchError?.code : undefined;
        const message = presentSessionStartupFailureCause(cause);
        return message !== null && cause !== undefined
            ? t('errors.errorWithCode', { message, code: cause })
            : t('errors.errorWithCode', { message: t(key), code: result.code });
    }
    return t(key);
}

/** Present a terminal operation failure through the same localized spawn-failure owner as the direct Action path. */
export function resolveSessionSpawnNewOperationFailureMessage(
    failure: ActionOperationFailureV1,
): string {
    return t('errors.errorWithCode', {
        message: t('newSession.failedToStart'),
        code: sessionSpawnFailureDisplayCode(failure),
    });
}

/** First-input admission is separate from creation; retain its diagnostic without claiming rejection. */
export function resolveSessionSpawnNewInitialInputFailureMessage(
    initialInput: Extract<SessionSpawnNewInitialInputDispositionV1, { status: 'rejected' | 'outcomeUnknown' }>,
    message: string,
): string {
    return t('errors.errorWithCode', { message, code: initialInput.code });
}
