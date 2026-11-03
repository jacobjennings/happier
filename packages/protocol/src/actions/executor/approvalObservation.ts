import { ActionIdSchema } from '../actionIds.js';
import { projectApprovalRequestForPublicRead } from '../actionApprovalPresentation.js';
import type { ActionExecuteResult } from '../actionExecutionResult.js';
import type { ActionExecutorContext, ActionExecutorDeps } from './types.js';
import type { ApprovalRequest } from '../../approvals/approvalRequestV1.js';
import { isApprovalArtifactObservationGrantedV1, readApprovalArtifactObservationRequestV1,
  readApprovalArtifactObservationSubjectV1 } from '../../approvals/approvalArtifactHeaderV1.js';

function readApprovalRequestStatus(raw: unknown): ApprovalRequest['status'] | null {
  return raw === 'open' || raw === 'approved' || raw === 'rejected'
    || raw === 'executed' || raw === 'failed' || raw === 'canceled' ? raw : null;
}

/** Public observation shares the private queue's body-authoritative scope owner. */
export async function executeApprovalObservationAction(params: Readonly<{
  actionId: 'approval.request.list' | 'approval.request.get';
  input: Readonly<Record<string, unknown>>;
  context: ActionExecutorContext;
  deps: Pick<ActionExecutorDeps, 'approvalsList' | 'approvalsGet' | 'resolveApiTokenGrantSessionMachineId'>;
}>): Promise<ActionExecuteResult> {
  const { actionId, input, context, deps } = params;
  const serverId = context.serverId?.trim() || null;
  const sessionId = context.externalActionTarget?.kind === 'session' ? context.externalActionTarget.sessionId : null;
  const grant = context.externalActionCredential?.grant;
  const resolveSessionMachine = deps.resolveApiTokenGrantSessionMachineId;
  const resolveSessionMachineId = resolveSessionMachine
    ? (sessionId: string) => resolveSessionMachine({ actionId, sessionId, context }) : undefined;
  if (actionId === 'approval.request.list') {
    if (!deps.approvalsList) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:approvals' };
    const listed = await deps.approvalsList({
      status: readApprovalRequestStatus(input.status),
      ...(typeof input.workflowRunId === 'string' ? { workflowRunId: input.workflowRunId } : {}),
      ...(typeof input.actionId === 'string' ? { actionId: ActionIdSchema.parse(input.actionId) } : {}),
      ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}),
      limit: typeof input.limit === 'number' ? input.limit : null,
      // Run correspondence is portable across device-local Home profile ids.
      // V1 queue history keeps its incumbent profile-scoped selection.
      serverId: typeof input.workflowRunId === 'string' ? context.serverIdentityId?.trim() || serverId : serverId,
      ...(sessionId ? { sessionId } : {}),
      ...(grant?.targets ? { targetGrant: grant, ...(resolveSessionMachineId ? { resolveSessionMachineId } : {}) } : {}),
    });
    return { ok: true, result: listed };
  }
  if (!deps.approvalsGet) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:approvals' };
  const artifactId = typeof input.artifactId === 'string' ? input.artifactId.trim() : '';
  if (!artifactId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
  const request = await deps.approvalsGet({ artifactId, serverId });
  const parsed = request ? readApprovalArtifactObservationRequestV1(request) : null;
  if (!parsed || sessionId && readApprovalArtifactObservationSubjectV1(parsed).sessionId !== sessionId
    || !await isApprovalArtifactObservationGrantedV1(parsed, grant, resolveSessionMachineId)) {
    return { ok: false, errorCode: 'approval_not_found', error: 'approval_not_found' };
  }
  return { ok: true, result: { artifactId, request: projectApprovalRequestForPublicRead(parsed.request),
    queryPlan: { kind: 'approval_artifact_id_lookup', backingStore: 'ArtifactStore',
      boundedBy: 'approval artifact id', hydratedTranscripts: false } } };
}
