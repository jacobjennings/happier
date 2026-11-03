import type { CliActionDepsParams, CurrentMachineControlIdentity } from '../actions/cliActionDeps/types';
import type { logger } from '@/ui/logger';
import type { ActionId } from '@happier-dev/protocol/actions/actionIds';
import type { ActionExecutorDeps, ActionExecutorContext } from '@happier-dev/protocol';
import type { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import type { tryDecryptSessionOwnerMetadataView } from '@/session/transport/encryption/sessionEncryptionContext';
import { RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import type { routeSessionGoalControl } from '@/session/goalControls/sessionGoalControlRouter';
import type { normalizeUsageLimitRecoveryOperationResult } from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult';
import type { CliMachineActionCall } from '@/session/actions/cliActionDeps/machineTransport';

type ResolvedSessionTransport = Extract<Awaited<ReturnType<typeof resolveSessionTransportContext>>, Readonly<{ ok: true }>>;
type GoalActionDeps = Pick<ActionExecutorDeps, 'sessionGoalGet' | 'sessionGoalSet' | 'sessionGoalClear'>;

export function createCliGoalActionDeps(
  params: CliActionDepsParams,
  { callMachineAction, callSessionRpcForTransport, normalizeStringValue, readCurrentMachineControlIdentity, readTransportSessionOwnerMetadata, resolveTransportForSession }: Readonly<{
    callMachineAction: CliMachineActionCall;
    callSessionRpcForTransport: (transport: ResolvedSessionTransport, methodSuffix: string, request: unknown, signal?: AbortSignal, timeoutMs?: number | null) => Promise<unknown>;
    normalizeStringValue: (value: unknown) => string | null;
    readCurrentMachineControlIdentity: () => Promise<CurrentMachineControlIdentity>;
    readTransportSessionOwnerMetadata: (transport: ResolvedSessionTransport) => ReturnType<typeof tryDecryptSessionOwnerMetadataView>;
    resolveTransportForSession: (idOrPrefix: string, signal?: AbortSignal, caller?: Readonly<{ context: ActionExecutorContext; actionId: ActionId }>, expectedSessionAddress?: ActionExecutorContext['expectedSessionAddress']) => Promise<ResolvedSessionTransport | Readonly<{
    ok: false;
    code: string;
    candidates?: string[];
  }>>;
  }>,
): GoalActionDeps {

  let initialSessionGoalTransport = params.initialSessionGoalTransport;
  const callRoutedSessionGoalControl = async (
    sessionId: string,
    operation: 'get' | 'set' | 'clear',
    request: Record<string, unknown>,
    options?: Readonly<{ resumeInactiveWithInitialGoal?: boolean; context?: ActionExecutorContext; signal?: AbortSignal; actionRequestId?: string; serverId?: string | null }>,
  ): Promise<unknown> => {
    const preparationStartedAt = performance.now();
    const signal = options?.signal ?? options?.context?.signal;
    const authority = options?.context ? options.context.authority ?? 'account_automation' : undefined;
    signal?.throwIfAborted();
    if (!params.credentials) {
      const { normalizeUsageLimitRecoveryOperationResult } = await import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult");
      return normalizeUsageLimitRecoveryOperationResult(
        { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },
        { sessionId },
      );
    }

    const relayGoal: NonNullable<Parameters<typeof routeSessionGoalControl>[0]['callMachineGoalRpc']> = async ({ machineId,
      operation: machineOperation, request: goalRequest, resumeInactiveWithInitialGoal }) => await callMachineAction({
        machineId, timeoutMs: null,
        ...(options?.serverId ? { serverId: options.serverId } : {}),
        method: machineOperation === 'get' ? RPC_METHODS.DAEMON_SESSION_GOAL_GET
          : machineOperation === 'clear' ? RPC_METHODS.DAEMON_SESSION_GOAL_CLEAR
            : resumeInactiveWithInitialGoal ? RPC_METHODS.DAEMON_SESSION_GOAL_SET_V2 : RPC_METHODS.DAEMON_SESSION_GOAL_SET,
        request: { sessionId, ...goalRequest, ...(resumeInactiveWithInitialGoal ? { resumeInactiveWithInitialGoal: true } : {}) },
        ...(options?.context ? { context: options.context, authority, authorization: options.context.rpcSessionAuthorization } : {}),
        ...(signal ? { signal } : {}), effectActionId: `session.goal.${machineOperation}`,
      });
    const invokeBoundSessionRpc = params.invokeBoundSessionRpc;
    if (sessionId === params.sessionId && invokeBoundSessionRpc) {
      const metadata = params.getCurrentSessionMetadata?.() ?? null;
      const { routeSessionGoalControl } = await import("@/session/goalControls/sessionGoalControlRouter");
      return await routeSessionGoalControl({
        token: params.credentials.token,
        credentials: params.credentials,
        sessionId,
        rawSession: { ...(params.rawSession ?? {}), active: true },
        metadata,
        currentMachineId: normalizeStringValue(params.rawSession?.machineId)
          ?? normalizeStringValue(metadata?.machineId),
        operation,
        ...(operation === 'set' ? { request } : {}),
        ...(params.mode === 'plain' ? { mode: params.mode, ctx: params.ctx } : { mode: params.mode, ctx: params.ctx }),
        signal,
        stageWorkStateMutation: params.stageWorkStateMutation,
        callMachineGoalRpc: relayGoal,
        callLiveSessionRpc: async () => await invokeBoundSessionRpc(
          operation === 'get'
            ? SESSION_RPC_METHODS.SESSION_GOAL_GET
            : operation === 'clear'
              ? SESSION_RPC_METHODS.SESSION_GOAL_CLEAR
              : SESSION_RPC_METHODS.SESSION_GOAL_SET,
          request,
          signal,
        ),
      });
    }

    const admittedTransport = initialSessionGoalTransport;
    initialSessionGoalTransport = undefined;
    const transport = admittedTransport?.sessionId === sessionId
      ? admittedTransport
      : await resolveTransportForSession(sessionId, signal);
    const transportResolvedAt = performance.now();
    const [{ logger }, { routeSessionGoalControl }] = await Promise.all([import("@/ui/logger"), import("@/session/goalControls/sessionGoalControlRouter")]);
    logger.debug('[SessionGoal] Action transport resolution', { sessionId, operation,
      durationMs: Math.round(transportResolvedAt - preparationStartedAt) });
    if (!transport.ok) {
      const { normalizeUsageLimitRecoveryOperationResult } = await import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult");
      return normalizeUsageLimitRecoveryOperationResult(
        {
          ok: false,
          errorCode: transport.code,
          error: transport.code,
        },
        { sessionId },
      );
    }

    const metadata = readTransportSessionOwnerMetadata(transport);
    const currentMachineIdentity = await readCurrentMachineControlIdentity();
    logger.debug('[SessionGoal] Machine identity resolution', { sessionId, operation,
      durationMs: Math.round(performance.now() - transportResolvedAt) });
    const actionRequestId = options?.actionRequestId ?? options?.context?.actionRequestId;
    return await routeSessionGoalControl({
      ...transport,
      token: params.credentials.token,
      credentials: params.credentials,
      sessionId: transport.sessionId,
      rawSession: transport.rawSession,
      metadata,
      currentMachineId: currentMachineIdentity.machineId,
      currentMachineHost: currentMachineIdentity.host,
      currentMachineHomeDir: currentMachineIdentity.homeDir,
      operation,
      ...(signal ? { signal } : {}),
      ...(authority ? { executionAuthority: authority } : {}),
      ...(actionRequestId ? { actionRequestId } : {}),
      resumeInactiveWithInitialGoal: operation === 'set' && typeof request.objective === 'string'
        && options?.resumeInactiveWithInitialGoal !== false,
      stageWorkStateMutation: params.stageWorkStateMutation,
      ...(operation === 'set' ? { request } : {}),
      // Goal preparation, native confirmation and inactive resume share the
      // admitted caller's lifetime; transport setup keeps its own existing bound.
      callLiveSessionRpc: async () => await callSessionRpcForTransport(
        transport,
        operation === 'get'
          ? SESSION_RPC_METHODS.SESSION_GOAL_GET
          : operation === 'clear'
            ? SESSION_RPC_METHODS.SESSION_GOAL_CLEAR
            : SESSION_RPC_METHODS.SESSION_GOAL_SET,
        request,
        signal,
        null,
      ),
      // The registered daemon Goal handler already admitted this transport.
      // Missing custody there is a wiring failure, never a relay back to itself.
      ...(admittedTransport ? {} : { callMachineGoalRpc: relayGoal }),
      machineResumeTransport: async (method, resumeRequest, resumeOptions) => await callMachineAction({
        machineId: currentMachineIdentity.machineId!, method, request: resumeRequest, timeoutMs: null,
        ...(options?.serverId ? { serverId: options.serverId } : {}),
        ...(options?.context ? { context: options.context, authority,
          authorization: options.context.rpcSessionAuthorization } : {}),
        ...(resumeOptions?.signal ? { signal: resumeOptions.signal } : {}), effectActionId: 'session.goal.set',
      }),
    });
  };
  return {

    sessionGoalGet: async ({ sessionId, ...options }) => {
      return await callRoutedSessionGoalControl(sessionId, 'get', {}, options);
    },

    sessionGoalSet: async ({ sessionId, objective, status, tokenBudget, ...options }) => {
      return await callRoutedSessionGoalControl(sessionId, 'set', {
        ...(typeof objective === 'string' ? { objective } : {}),
        ...(typeof status === 'string' && status.trim().length > 0 ? { status: status.trim() } : {}),
        ...(typeof tokenBudget !== 'undefined' ? { tokenBudget: tokenBudget ?? null } : {}),
      }, options);
    },

    sessionGoalClear: async ({ sessionId, ...options }) => {
      return await callRoutedSessionGoalControl(sessionId, 'clear', {}, options);
    },
  };
}
