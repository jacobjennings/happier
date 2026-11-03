import type { ResolvedSessionTransport } from '../actions/cliActionDeps/types';
import type { CliActionDepsParams } from '../actions/cliActionDeps/types';
import type { ActionId } from '@happier-dev/protocol/actions/actionIds';
import type { ActionExecutorDeps, ActionExecutorContext } from '@happier-dev/protocol';
import { HandoffTargetReplacementPreflightResultV1Schema } from '@happier-dev/protocol/sessions/control/handoff/workspaceSyncSchemas';
import type { resolveSessionHandoffSourceAuthority } from '@/session/handoff/resolveSessionHandoffSourceAuthority';
import type { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import { readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';
import type { CliMachineActionCall } from '@/session/actions/cliActionDeps/machineTransport';
type FamilyActionDeps = Pick<ActionExecutorDeps, 'sessionHandoffTargetReplacementApprovalPreflight' | 'sessionHandoffStart'>;

export function createCliSessionHandoffActionDeps(
  params: CliActionDepsParams,
  { callMachineAction, notSupported, resolveTransportForSession }: Readonly<{

    callMachineAction: CliMachineActionCall;
    notSupported: () => never;
    resolveTransportForSession: (idOrPrefix: string, signal?: AbortSignal, caller?: Readonly<{ context: ActionExecutorContext; actionId: ActionId }>, expectedSessionAddress?: ActionExecutorContext['expectedSessionAddress']) => Promise<ResolvedSessionTransport | Readonly<{
    ok: false;
    code: string;
    candidates?: string[];
  }>>;
  }>,
): FamilyActionDeps {
  return {
    // One destination-approval preflight for both destination-choosing Action
    // families. Handoff expresses its intent through a workspace action; direct
    // Project linking has no Session and states its intent and mode explicitly.
    sessionHandoffTargetReplacementApprovalPreflight: async ({
      targetMachineId,
      targetPath,
      workspaceAction,
      activatesExactMirror,
      destinationIntent,
      serverId,
      operationId,
      effectActionId,
      context,
      signal,
    }) => {
      const handoffChoosesDestination = workspaceAction?.kind === 'copy_once'
        || workspaceAction?.kind === 'create_relationship';
      if (!handoffChoosesDestination && destinationIntent === undefined) {
        return { type: 'not_required' as const };
      }
      if (!params.credentials || !targetPath?.trim() || !serverId?.trim() || !operationId.trim()) {
        return { type: 'error' as const, result: { ok: false, errorCode: 'invalid_input', error: 'invalid_input' } };
      }
      const mirrors = activatesExactMirror
        ?? (workspaceAction?.kind === 'create_relationship' && workspaceAction.mode === 'mirror_exactly');
      try {
        return HandoffTargetReplacementPreflightResultV1Schema.parse(await callMachineAction({
          machineId: targetMachineId,
          method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_REPLACEMENT_PREFLIGHT,
          request: {
            v: 1,
            serverId: serverId.trim(),
            machineId: targetMachineId,
            operationId: operationId.trim(),
            targetPath: targetPath.trim(),
            ...(mirrors ? { activatesExactMirror: true } : {}),
            ...(destinationIntent ? { destinationIntent } : {}),
          },
          context,
          effectActionId,
          exactMachine: true,
          ...(signal ? { signal } : {}),
        }));
      } catch (error) {
        const errorCode = readRpcErrorCode(error) ?? 'target_unavailable';
        return { type: 'error' as const, result: { ok: false, errorCode, error: errorCode } };
      }
    },
    sessionHandoffStart: async ({
      sessionId,
      targetMachineId,
      targetPath,
      targetSessionStorageMode,
      stateTransfer,
      workspaceAction,
      serverId,
      actionRequestId,
      handoffTargetReplacementApproval,
      handoffTargetReplacementApprovalReceiptId,
      handoffTargetReplacementApprovalActionInput,
      signal,
    }) => {
      if (!params.credentials) return notSupported();
      const transport = await resolveTransportForSession(sessionId, signal);
      if (!transport.ok) {
        return { ok: false, errorCode: transport.code, error: transport.code };
      }
      // One owner for the handoff source facts, shared with the daemon's tracked
      // coordinator: machine custody and transcript-storage authority both come
      // from OWNER metadata, and an unresolved link refuses here rather than
      // being stamped as `persisted` on a request that stops the source.
      const { resolveSessionHandoffSourceAuthority } = await import('@/session/handoff/resolveSessionHandoffSourceAuthority');
      const source = resolveSessionHandoffSourceAuthority({
        credentials: params.credentials,
        rawSession: transport.rawSession,
        accountEncryptionMode: transport.accountEncryptionCurrentness.mode,
      });
      if (!source.ok) {
        return { ok: false, errorCode: source.errorCode, error: source.error };
      }
      const sourceMachineId = source.sourceMachineId;
      return await callMachineAction({
        machineId: sourceMachineId,
        method: RPC_METHODS.DAEMON_SESSION_HANDOFF_START_V3,
        request: {
          sessionId: transport.sessionId,
          sourceMachineId,
          targetMachineId,
          sessionStorageMode: source.sessionStorageMode,
          ...(targetPath ? { targetPath } : {}),
          ...(targetSessionStorageMode ? { targetSessionStorageMode } : {}),
          ...(stateTransfer ? { stateTransfer } : {}),
          preferredTransportStrategies: ['direct_peer', 'server_routed_stream'],
          ...(workspaceAction ? { workspaceAction } : {}),
          ...(serverId ? { accountServerId: serverId } : {}),
          ...(actionRequestId ? { actionRequestId } : {}),
          ...(handoffTargetReplacementApproval ? { handoffTargetReplacementApproval } : {}),
          ...(handoffTargetReplacementApprovalReceiptId ? {
            handoffTargetReplacementApprovalReceiptId,
            handoffTargetReplacementApprovalActionInput,
          } : {}),
        },
        ...(signal ? { signal } : {}),
      });
    },
  };
}
