import type { CliActionDepsParams } from './types';
import type { readCurrentRunnerAgentStartPolicyV1 } from '@/agent/runtime/session/process/agentRuntimeDaemonServiceAuthorityClient';
import { measureActionStartPhaseV1 } from '@happier-dev/protocol/actions/executor/agentStartAdmission';
import { AgentStartSessionCallerV1Schema } from '@happier-dev/protocol/account/settings/admitAgentStartV1';
import type { ActionExecutorDeps, ActionExecutorContext } from '@happier-dev/protocol';
import { type RoleSourceReader } from '@/session/roles/roleSources';
import { readAccountIdFromToken } from '@/cloud/decodeJwtPayload';
import type { resolveCliAgentStartContextV1 } from '../resolveCliAgentStartContextV1';
import { resolveCliActionCallerSession } from '../resolveCliActionCallerSession';
import type { fetchSessionById } from '@/session/transport/http/sessionsHttp';
import type { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { readPreparedAccountRoleOverrides } from '@/session/roles/sessionRoleContext';
import type { runWithRequesterSessionCurrentnessCheckpoint, runWithoutRequesterSessionCurrentnessCheckpoint } from '@/daemon/sessionEncryption/requesterCurrentness';
export function createCliAgentStartContext(
  params: Pick<CliActionDepsParams, 'actionsSettingsProvider' | 'credentials' | 'getAgentStartRunCaller' | 'getCurrentAppliedChildSelection' | 'getCurrentTurnWorkDepth' | 'getSessionRoleContext' | 'readAgentStartPolicy' | 'savedSecretOperationContext' | 'sessionId' | 'token'>,
  { prepareAccountRoleOverrides, readReadyAccountRoleOverrides, readRoleSources, resolveActionCallerSession }: Readonly<{
    prepareAccountRoleOverrides: (signal?: AbortSignal) => Promise<void>;
    readReadyAccountRoleOverrides: (signal?: AbortSignal) => ReturnType<typeof readPreparedAccountRoleOverrides>;
    readRoleSources: RoleSourceReader;
    resolveActionCallerSession: (context: ActionExecutorContext) => ReturnType<typeof resolveCliActionCallerSession>;
  }>,
  readEffectiveDeps: () => ActionExecutorDeps,
): NonNullable<ActionExecutorDeps['resolveAgentStartContext']> {
  const resolveAgentStartContext: NonNullable<ActionExecutorDeps['resolveAgentStartContext']> = async (context, options) => {
    const binding = context.externalActionExecutionAuthorization?.binding;
    const workflowOrigin = binding?.workflowActionOrigin;
    const witness = workflowOrigin?.sessionAuthority;
    if (workflowOrigin || context.actionCaller?.kind === 'workflowRun') {
      if (!binding || !workflowOrigin || !witness || context.actionCaller?.kind !== 'workflowRun'
        || context.actionCaller.runId !== workflowOrigin.runId || context.actionRequestId !== binding?.requestId
        || binding.accountId !== readAccountIdFromToken(params.token)
        || binding.target.kind !== 'session' || binding.target.sessionId !== params.sessionId) return null;
      const settings = params.actionsSettingsProvider?.getAccountSettings?.();
      if (!settings) return null;
      return { caller: { kind: 'originless', runId: workflowOrigin.runId, runDepth: witness.runDepth,
          ...(witness.runOriginSessionId ? { runOriginSessionId: witness.runOriginSessionId } : {}) },
        baseline: { machineId: binding.machineId, directory: witness.directory },
        ledSubtreeSessionIds: [], roles: {}, callerPermissionCeiling: witness.authorization.admittedPermissionCeiling,
        workDepthLimit: settings.workDepthLimit, allowLists: settings.sessionAgentStartAllowListsV1 };
    }
    const session = await measureActionStartPhaseV1(context, 'caller_session', () => resolveActionCallerSession(context));
    const refuse = (reason: import('@happier-dev/protocol/workflows/workflowProgressV1').WorkflowTargetUnavailableReasonV1) => {
      context.recordActionStartDiagnostic?.({ phase: 'agent_start_context', refusalReason: reason });
      return null;
    };
    if (!session) return refuse('caller_session_unavailable');
    const runCaller = params.getAgentStartRunCaller?.();
    if (params.getAgentStartRunCaller && !runCaller) return refuse('caller_run_unavailable');
    const caller = context.actionCaller;
    const admittedCaller = caller?.kind === 'session'
      ? AgentStartSessionCallerV1Schema.safeParse(caller)
      : null;
    if (admittedCaller && !admittedCaller.success) return refuse('caller_witness_invalid');
    let starterDepth: unknown = admittedCaller?.success ? admittedCaller.data.starterDepth : session.workDepth;
    if (starterDepth === undefined && !runCaller) {
      try {
        const { fetchSessionById } = await import("@/session/transport/http/sessionsHttp");
        const persisted = await fetchSessionById({ reason: 'session-action', token: params.token, sessionId: session.sessionId });
        if (persisted && 'workDepth' in persisted) starterDepth = persisted.workDepth;
      } catch { return refuse('caller_depth_unavailable'); }
    }
    const turnId = context.sessionInputSource && typeof context.sessionInputSource === 'object'
      && 'sourceTurnId' in context.sessionInputSource && typeof context.sessionInputSource.sourceTurnId === 'string'
      ? context.sessionInputSource.sourceTurnId : undefined;
    const turnDepth = (admittedCaller?.success ? admittedCaller.data.turnDepth : params.getCurrentTurnWorkDepth?.(turnId))
      ?? (context.actionCaller?.kind !== 'session' && session.sessionId === params.sessionId
        && !params.getCurrentTurnWorkDepth ? 0 : undefined);
    if (turnDepth === undefined) return refuse('caller_depth_unavailable');
    // Scope admission consumes the same validated caller, not Agent launch
    // selections. Catalog hydration repeats requester authority round trips
    // without contributing any fact to the fresh Home subtree decision.
    const scopeOnly = options?.purpose === 'session_scope';
    const requiresBoundStartPolicy = !scopeOnly && (Boolean(params.readAgentStartPolicy)
      || (params.actionsSettingsProvider ? !params.actionsSettingsProvider.getAccountSettings : !params.credentials));
    const sessionRoleContext = !scopeOnly ? params.getSessionRoleContext?.() : undefined;
    const prepareStartReads = async () => {
      if (!scopeOnly) await measureActionStartPhaseV1(context, 'role_overrides', () => prepareAccountRoleOverrides(context.signal));
      // The live Session owns fresh Role resolution, including its installed
      // Agent sources. A runner's cold built-in inventory cannot re-admit it.
      const roles = sessionRoleContext ? await measureActionStartPhaseV1(context, 'role_sources',
        () => sessionRoleContext.resolveRoles(context.signal)) : undefined;
      const roleSources = scopeOnly || sessionRoleContext ? undefined
        : await measureActionStartPhaseV1(context, 'role_sources', () => readRoleSources(context.signal));
      const settings = scopeOnly ? null : await measureActionStartPhaseV1(context, 'account_settings', async () =>
        {
        const [{ readCurrentRunnerAgentStartPolicyV1 }, { runWithoutRequesterSessionCurrentnessCheckpoint }, { bootstrapAccountSettingsContext }] = await Promise.all([import("@/agent/runtime/session/process/agentRuntimeDaemonServiceAuthorityClient"), import("@/daemon/sessionEncryption/requesterCurrentness"), import("@/settings/accountSettings/bootstrapAccountSettingsContext")]);
        return requiresBoundStartPolicy ? await (params.readAgentStartPolicy
          ? params.readAgentStartPolicy(context.signal) : readCurrentRunnerAgentStartPolicyV1(session.sessionId, context.signal))
        : params.actionsSettingsProvider?.getAccountSettings?.()
        ?? (params.credentials ? (await runWithoutRequesterSessionCurrentnessCheckpoint(() =>
          bootstrapAccountSettingsContext({ credentials: params.credentials!, mode: 'blocking' }))).settings : null);
      });
      let appliedChildSelection: import('@/agent/runtime/bridges/executionRun/runtime/openInputs').ExecutionRunAppliedParentSelection | undefined;
      if (!scopeOnly && session.sessionId === params.sessionId && params.getCurrentAppliedChildSelection) {
        const { runWithoutRequesterSessionCurrentnessCheckpoint } = await import("@/daemon/sessionEncryption/requesterCurrentness");
        try { appliedChildSelection = await runWithoutRequesterSessionCurrentnessCheckpoint(async () => params.getCurrentAppliedChildSelection!()); }
        catch { appliedChildSelection = { status: 'unavailable' }; }
      }
      const availableAgents = scopeOnly || sessionRoleContext ? undefined : await measureActionStartPhaseV1(context, 'agent_inventory',
        () => readEffectiveDeps().agentsBackendsList({ includeDisabled: false }));
      return { roles, roleSources, settings, appliedChildSelection, availableAgents };
    };
    // Built-in Role/Artifact, captured Settings and ACP reads join one bounded
    // observation. Their owners exclude migrations, source/history maintenance
    // and private publication; injected preparation above also leaves the scope.
    const [{ runWithRequesterSessionCurrentnessCheckpoint }, { resolveCliAgentStartContextV1 }] = await Promise.all([import("@/daemon/sessionEncryption/requesterCurrentness"), import("../resolveCliAgentStartContextV1")]);
    const { roles, roleSources, settings, appliedChildSelection, availableAgents } = await (params.savedSecretOperationContext && !scopeOnly
      ? runWithRequesterSessionCurrentnessCheckpoint(prepareStartReads, { readOnly: true }) : prepareStartReads());
    context.signal?.throwIfAborted();
    if (!scopeOnly && params.savedSecretOperationContext && !await params.savedSecretOperationContext.isCurrent()) {
      return refuse('caller_session_unavailable');
    }
    context.signal?.throwIfAborted();
    if (requiresBoundStartPolicy && !settings) return refuse('requester_projection_unavailable');
    return resolveCliAgentStartContextV1({
      recordActionStartDiagnostic: context.recordActionStartDiagnostic,
      sessionId: session.sessionId,
      machineId: session.machineId, directory: session.directory,
      backendTarget: session.backendTarget ?? null,
      metadata: session.metadata, starterDepth: typeof starterDepth === 'number' ? starterDepth : undefined, runCaller,
      appliedChildSelection,
      turnDepth,
      callerPermissionMode: context.callerPermissionMode ?? null, settings,
      accountRoleOverrides: scopeOnly ? undefined : await readReadyAccountRoleOverrides(context.signal),
      ...(scopeOnly ? { roles: {} } : roles ? { roles } : {}),
      availableAgentTargetKeys: availableAgents?.items
        .filter((item) => item.enabled).map((item) => item.targetKey),
      roleSourceInventory: roleSources,
    });
  };
  return resolveAgentStartContext;
}
