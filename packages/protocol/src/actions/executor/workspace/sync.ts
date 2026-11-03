import { WorkspaceSyncConflictResolveActionInputV1Schema, WorkspaceSyncConflictsListActionInputV1Schema, WorkspaceSyncConflictInspectActionInputV1Schema, WorkspaceSyncRelationshipsListActionInputV1Schema, WorkspaceSyncRelationshipCreateActionInputV1Schema, WorkspaceSyncRelationshipDisableActionInputV1Schema, WorkspaceSyncRelationshipEnableActionInputV1Schema, WorkspaceSyncRelationshipFlushActionInputV1Schema, WorkspaceSyncRelationshipTerminateActionInputV1Schema } from '../../../sessions/control/handoff/workspaceSyncSchemas.js';
import { completeActionResult } from '../resultProjection.js';
import { normalizeId } from '../inputReading.js';
import type { CoreInvocation, DispatchFacts, PreparedCoreAdmission } from '../coreInvocation.js';
import type { ActionExecuteResult, ActionExecutorContext, ActionExecutorDeps } from '../types.js';



export async function dispatchWorkspaceSync(inv: Pick<CoreInvocation, 'actionId' | 'deps' | 'ctx' | 'parsed'>): Promise<ActionExecuteResult | null> {
  const { actionId, deps, ctx, parsed } = inv;

        if (actionId === 'workspace.sync.conflict.resolve') {
          if (!deps.workspaceSyncConflictResolve) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.conflict.resolve' };
          }
          if (!ctx.actionRequestId) {
            return { ok: false, errorCode: 'approval_stale', error: 'approval_stale' };
          }
          const res = await deps.workspaceSyncConflictResolve({
            actionReceiptId: ctx.actionRequestId,
            input: WorkspaceSyncConflictResolveActionInputV1Schema.parse(parsed.data),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          return completeActionResult(res);
        }

        if (actionId === 'workspace.sync.relationship.create') {
          if (!deps.workspaceSyncRelationshipCreate) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.relationship.create' };
          }
          // Relationship identity is derived from the admitted Action request,
          // never from a caller-supplied value: the target daemon re-derives
          // the same rule to authorize a destructive destination.
          const operationId = normalizeId(ctx.handoffTargetReplacementApproval?.operationId)
            || normalizeId(ctx.actionRequestId);
          if (!operationId) {
            return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          }
          const res = await deps.workspaceSyncRelationshipCreate({
            input: WorkspaceSyncRelationshipCreateActionInputV1Schema.parse(parsed.data),
            operationId,
            ...(normalizeId(ctx.serverIdentityId) ? { serverIdentityId: normalizeId(ctx.serverIdentityId) } : {}),
            ...(normalizeId(ctx.serverId) ? { serverId: normalizeId(ctx.serverId) } : {}),
            ...(ctx.handoffTargetReplacementApproval && ctx.handoffTargetReplacementApprovalReceiptId
              ? {
                  targetReplacementApproval: ctx.handoffTargetReplacementApproval,
                  targetReplacementApprovalReceiptId: ctx.handoffTargetReplacementApprovalReceiptId,
                }
              : {}),
            context: ctx,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          return completeActionResult(res, { treatReturnedErrorEnvelopeAsFailure: true });
        }

        if (actionId === 'workspace.sync.relationship.terminate') {
          if (!deps.workspaceSyncRelationshipTerminate) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.relationship.terminate' };
          }
          const res = await deps.workspaceSyncRelationshipTerminate({
            input: WorkspaceSyncRelationshipTerminateActionInputV1Schema.parse(parsed.data),
            ...(normalizeId(ctx.serverId) ? { serverId: normalizeId(ctx.serverId) } : {}),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          return completeActionResult(res, { treatReturnedErrorEnvelopeAsFailure: true });
        }

        if (actionId === 'workspace.sync.relationship.disable') {
          if (!deps.workspaceSyncRelationshipDisable) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.relationship.disable' };
          const res = await deps.workspaceSyncRelationshipDisable({ input: WorkspaceSyncRelationshipDisableActionInputV1Schema.parse(parsed.data),
            ...(normalizeId(ctx.serverId) ? { serverId: normalizeId(ctx.serverId) } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) });
          return completeActionResult(res, { treatReturnedErrorEnvelopeAsFailure: true });
        }

        if (actionId === 'workspace.sync.relationship.enable') {
          if (!deps.workspaceSyncRelationshipEnable) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.relationship.enable' };
          const res = await deps.workspaceSyncRelationshipEnable({ input: WorkspaceSyncRelationshipEnableActionInputV1Schema.parse(parsed.data),
            ...(normalizeId(ctx.serverId) ? { serverId: normalizeId(ctx.serverId) } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) });
          return completeActionResult(res, { treatReturnedErrorEnvelopeAsFailure: true });
        }

        if (actionId === 'workspace.sync.relationship.flush') {
          if (!deps.workspaceSyncRelationshipFlush) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.relationship.flush' };
          const res = await deps.workspaceSyncRelationshipFlush({ input: WorkspaceSyncRelationshipFlushActionInputV1Schema.parse(parsed.data),
            ...(normalizeId(ctx.serverId) ? { serverId: normalizeId(ctx.serverId) } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) });
          return completeActionResult(res, { treatReturnedErrorEnvelopeAsFailure: true });
        }

        if (actionId === 'workspace.sync.relationships.list') {
          if (!deps.workspaceSyncRelationshipsList) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.relationships.list' };
          }
          const res = await deps.workspaceSyncRelationshipsList({
            input: WorkspaceSyncRelationshipsListActionInputV1Schema.parse(parsed.data),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          return completeActionResult(res, { treatReturnedErrorEnvelopeAsFailure: true });
        }

        if (actionId === 'workspace.sync.conflicts.list') {
          if (!deps.workspaceSyncConflictsList) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.conflicts.list' };
          }
          const res = await deps.workspaceSyncConflictsList({
            input: WorkspaceSyncConflictsListActionInputV1Schema.parse(parsed.data),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          return completeActionResult(res);
        }

        if (actionId === 'workspace.sync.conflict.inspect') {
          if (!deps.workspaceSyncConflictInspect) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:workspace.sync.conflict.inspect' };
          }
          const res = await deps.workspaceSyncConflictInspect({
            input: WorkspaceSyncConflictInspectActionInputV1Schema.parse(parsed.data),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          return completeActionResult(res);
        }
  return null;
}
