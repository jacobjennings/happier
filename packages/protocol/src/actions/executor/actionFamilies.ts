import { ACTION_ID_FAMILIES_V1, type ActionId } from '../actionIds.js';
import type { HostExternalSessionActionId, PluginExternalSessionActionId, ScmActionId, SessionPermissionRemoteActionId } from './types.js';

const SCM_ACTION_ID_SET: ReadonlySet<ActionId> = new Set([
  ...ACTION_ID_FAMILIES_V1.scm_git,
  ...ACTION_ID_FAMILIES_V1.scm_pull_request,
  ...ACTION_ID_FAMILIES_V1.scm_repository,
  ...ACTION_ID_FAMILIES_V1.scm_diff_summary,
]);

export const SESSION_TRANSCRIPT_ACTION_ID_SET: ReadonlySet<ActionId> = new Set(
  ACTION_ID_FAMILIES_V1.session_transcripts,
);

export function delegatesApprovalClassificationToResolvedAction(actionId: ActionId): boolean {
  return actionId === 'action.invoke' || actionId === 'ui.current_context.command.invoke';
}

// Plugin-provenance External Session registration. The low-level ephemeral
// viewer-lease Actions (`sessions.external.follow`/`unfollow`) are excluded
// from the plugin projection by the canonical owner
// (`PLUGIN_SURFACE_EXCLUSION_REASONS`), so they must not be registered here;
// authors use `SessionsService.external.followTranscript`, and the retained
// host route lives in HOST_EXTERNAL_SESSION_ACTION_ID_SET below.
const PLUGIN_EXTERNAL_SESSION_ACTION_ID_SET: ReadonlySet<ActionId> = new Set([
  'sessions.external.materialize.start',
  'sessions.external.status.get',
  'sessions.external.operation.status.get',
  'sessions.external.operation.cancel',
  'sessions.external.operation.resume',
  'sessions.external.operation.retry',
  'sessions.external.operation.discard',
  'sessions.external.backgroundFollow.set',
]);

const HOST_EXTERNAL_SESSION_ACTION_ID_SET: ReadonlySet<ActionId> = new Set([
  ...PLUGIN_EXTERNAL_SESSION_ACTION_ID_SET,
  // Released RPC/API clients reach the ephemeral lease seams through the host
  // external-session owner; that domain/RPC implementation stays here.
  'sessions.external.follow',
  'sessions.external.unfollow',
  'sessions.external.candidates.list',
  'sessions.external.candidate.delete',
  'sessions.external.link.ensure',
  'sessions.external.transcript.page',
  'sessions.external.transcript.readAfter',
  'sessions.external.takeover.start',
]);

const SESSION_PERMISSION_REMOTE_ACTION_ID_SET: ReadonlySet<ActionId> = new Set([
  'session.permission.remote.pending.list',
  'session.permission.remote.respond',
  'session.user_action.remote.answer',
  'session.permission.remote.grants.list',
  'session.permission.remote.grants.revoke',
]);

export function isPluginExternalSessionActionId(
  actionId: ActionId,
): actionId is PluginExternalSessionActionId {
  return PLUGIN_EXTERNAL_SESSION_ACTION_ID_SET.has(actionId);
}

export function isHostExternalSessionActionId(
  actionId: ActionId,
): actionId is HostExternalSessionActionId {
  return HOST_EXTERNAL_SESSION_ACTION_ID_SET.has(actionId);
}

export function isSessionPermissionRemoteActionId(
  actionId: ActionId,
): actionId is SessionPermissionRemoteActionId {
  return SESSION_PERMISSION_REMOTE_ACTION_ID_SET.has(actionId);
}

export function isScmActionId(actionId: ActionId): actionId is ScmActionId {
  return SCM_ACTION_ID_SET.has(actionId);
}

export function isActionFamilyId<Id extends string>(
  actionId: string,
  schema: Readonly<{ options: readonly Id[] }>,
): actionId is Id {
  return schema.options.some((id) => id === actionId);
}
