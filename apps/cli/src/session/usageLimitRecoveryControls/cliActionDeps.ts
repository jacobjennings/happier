import type { ResolvedSessionTransport } from '../actions/cliActionDeps/types';
import type { CliActionDepsParams } from '../actions/cliActionDeps/types';
import type { readLatestUsageLimitFailureIssue } from '@/session/usageLimitRecoveryControls/readLatestUsageLimitFailureIssue';
import type { ActionId } from '@happier-dev/protocol/actions/actionIds';
import type { SessionUsageLimitRecoveryResumePromptModeV1, ActionExecutorDeps, ActionExecutorContext } from '@happier-dev/protocol';
import type { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { tryDecryptSessionOwnerMetadataView } from '@/session/transport/encryption/sessionEncryptionContext';
import type { readRuntimeAuthUsageLimitRecoveryAttemptId } from '@/session/usageLimitRecoveryControls/runtimeAuthUsageLimitRecoveryControl';
import type { callMachineRpc } from '@/session/transport/rpc/machineRpc';
import { RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import type { normalizeUsageLimitRecoveryOperationResult } from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult';
import type { resolveUsageLimitRecoveryEnabled, usageLimitRecoveryDisabledResult } from '@/features/usageLimitRecoveryFeatureGate';
import { readMachineActionRpcResult } from '@happier-dev/protocol/actions/executor/actionFailureEnvelope';
type FamilyActionDeps = Pick<ActionExecutorDeps, 'sessionUsageLimitWaitResumeEnable' | 'sessionUsageLimitWaitResumeCancel' | 'sessionUsageLimitCheckNow' | 'sessionUsageLimitSwitchAccountNow' | 'sessionUsageLimitConsumeResetCredit'>;


function readResumePromptMode(value: unknown): SessionUsageLimitRecoveryResumePromptModeV1 | undefined {
  return value === 'standard' || value === 'off' || value === 'custom' ? value : undefined;
}
export function createCliUsageLimitRecoveryActionDeps(
  params: CliActionDepsParams,
  { callSessionRpcForTransport, normalizeStringValue, readTransportSessionOwnerMetadata, resolveTransportForSession }: Readonly<{

    callSessionRpcForTransport: (transport: ResolvedSessionTransport, methodSuffix: string, request: unknown, signal?: AbortSignal, timeoutMs?: number | null) => Promise<unknown>;
    normalizeStringValue: (value: unknown) => string | null;
    readTransportSessionOwnerMetadata: (transport: ResolvedSessionTransport) => ReturnType<typeof tryDecryptSessionOwnerMetadataView>;
    resolveTransportForSession: (idOrPrefix: string, signal?: AbortSignal, caller?: Readonly<{ context: ActionExecutorContext; actionId: ActionId }>, expectedSessionAddress?: ActionExecutorContext['expectedSessionAddress']) => Promise<ResolvedSessionTransport | Readonly<{
    ok: false;
    code: string;
    candidates?: string[];
  }>>;
  }>,
): FamilyActionDeps {

  const isUsageLimitRecoveryEnabled = async (): Promise<boolean> => {
    if (typeof params.isUsageLimitRecoveryEnabled === 'function') {
      return await params.isUsageLimitRecoveryEnabled();
    }
    const { resolveUsageLimitRecoveryEnabled } = await import("@/features/usageLimitRecoveryFeatureGate");
    return await resolveUsageLimitRecoveryEnabled();
  };

  const callRoutedUsageLimitRecoveryControl = async (
    sessionId: string,
    operation: 'enable' | 'cancel' | 'checkNow' | 'switchAccountNow' | 'consumeResetCredit',
    request: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!params.credentials) {
      const { normalizeUsageLimitRecoveryOperationResult } = await import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult");
      return normalizeUsageLimitRecoveryOperationResult(
        { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },
        { sessionId },
      );
    }

    const transport = await resolveTransportForSession(sessionId);
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
    const [{ readRuntimeAuthUsageLimitRecoveryAttemptId }, { readLatestUsageLimitFailureIssue }] = await Promise.all([import("@/session/usageLimitRecoveryControls/runtimeAuthUsageLimitRecoveryControl"), import("@/session/usageLimitRecoveryControls/readLatestUsageLimitFailureIssue")]);
    const daemonOwnedCheck = operation === 'checkNow' && readRuntimeAuthUsageLimitRecoveryAttemptId(metadata, readLatestUsageLimitFailureIssue(transport.rawSession)) !== null;
    if (transport.rawSession.active === true && !daemonOwnedCheck) {
      const { normalizeUsageLimitRecoveryOperationResult } = await import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult");
      return normalizeUsageLimitRecoveryOperationResult(await callSessionRpcForTransport(
        transport,
        operation === 'enable'
          ? SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE
          : operation === 'cancel'
            ? SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL
            : operation === 'consumeResetCredit'
              ? SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CONSUME_RESET_CREDIT
              : SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CHECK_NOW,
        request,
      ), { sessionId: transport.sessionId });
    }

    const rawMachineId = normalizeStringValue(transport.rawSession.machineId);
    const metadataMachineId = normalizeStringValue(metadata?.machineId);
    if (rawMachineId && metadataMachineId && rawMachineId !== metadataMachineId) {
      const { normalizeUsageLimitRecoveryOperationResult } = await import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult");
      return normalizeUsageLimitRecoveryOperationResult({
        ok: false,
        errorCode: 'session_usage_limit_recovery_control_target_machine_mismatch',
        error: 'session_usage_limit_recovery_control_target_machine_mismatch',
      }, { sessionId: transport.sessionId });
    }
    const machineId = rawMachineId ?? metadataMachineId;
    if (!machineId) {
      const { normalizeUsageLimitRecoveryOperationResult } = await import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult");
      return normalizeUsageLimitRecoveryOperationResult({
        ok: false,
        errorCode: 'session_usage_limit_recovery_control_target_machine_unavailable',
        error: 'session_usage_limit_recovery_control_target_machine_unavailable',
      }, { sessionId: transport.sessionId });
    }

    const method = operation === 'enable'
      ? RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE
      : operation === 'cancel'
        ? RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL
        : operation === 'consumeResetCredit'
          ? RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CONSUME_RESET_CREDIT
          : RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW;
    const [{ normalizeUsageLimitRecoveryOperationResult }, { callMachineRpc }] = await Promise.all([import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult"), import("@/session/transport/rpc/machineRpc")]);
    let result: unknown;
    try {
      result = await callMachineRpc({
        credentials: params.credentials,
        machineId,
        method,
        request,
      });
    } catch {
      return normalizeUsageLimitRecoveryOperationResult({
        ok: false,
        errorCode: 'session_usage_limit_recovery_control_target_machine_unavailable',
        error: 'session_usage_limit_recovery_control_target_machine_unavailable',
      }, { sessionId: transport.sessionId });
    }
    return normalizeUsageLimitRecoveryOperationResult(readMachineActionRpcResult(result), { sessionId: transport.sessionId });
  };
  return {

    sessionUsageLimitWaitResumeEnable: async ({ sessionId, issueFingerprint, remember, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        const [{ normalizeUsageLimitRecoveryOperationResult }, { usageLimitRecoveryDisabledResult }] = await Promise.all([import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult"), import("@/features/usageLimitRecoveryFeatureGate")]);
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      const request = {
        sessionId,
        ...(typeof issueFingerprint === 'string' ? { issueFingerprint } : {}),
        ...(remember === true ? { rememberPreference: true } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      };
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'enable', request);
    },

    sessionUsageLimitWaitResumeCancel: async ({ sessionId, issueFingerprint, armedAtMs, runtimeAuthRecoveryAttemptId }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        const [{ normalizeUsageLimitRecoveryOperationResult }, { usageLimitRecoveryDisabledResult }] = await Promise.all([import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult"), import("@/features/usageLimitRecoveryFeatureGate")]);
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const request = {
        sessionId,
        ...(issueFingerprint !== undefined ? { issueFingerprint } : {}),
        ...(typeof armedAtMs === 'number' && Number.isFinite(armedAtMs)
          ? { armedAtMs: Math.trunc(armedAtMs) }
          : {}),
        ...(typeof runtimeAuthRecoveryAttemptId === 'string' && runtimeAuthRecoveryAttemptId.trim().length > 0
          ? { runtimeAuthRecoveryAttemptId: runtimeAuthRecoveryAttemptId.trim() }
          : {}),
      };
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'cancel', request);
    },

    sessionUsageLimitCheckNow: async ({ sessionId, agentId, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        const [{ normalizeUsageLimitRecoveryOperationResult }, { usageLimitRecoveryDisabledResult }] = await Promise.all([import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult"), import("@/features/usageLimitRecoveryFeatureGate")]);
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'checkNow', {
        sessionId,
        ...(normalizedAgentId.length > 0 ? { agentId: normalizedAgentId } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      });
    },

    sessionUsageLimitSwitchAccountNow: async ({ sessionId, agentId, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        const [{ normalizeUsageLimitRecoveryOperationResult }, { usageLimitRecoveryDisabledResult }] = await Promise.all([import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult"), import("@/features/usageLimitRecoveryFeatureGate")]);
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'switchAccountNow', {
        sessionId,
        operation: 'switch_account_now',
        ...(normalizedAgentId.length > 0 ? { agentId: normalizedAgentId } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      });
    },

    sessionUsageLimitConsumeResetCredit: async ({ sessionId, agentId, issueFingerprint, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        const [{ normalizeUsageLimitRecoveryOperationResult }, { usageLimitRecoveryDisabledResult }] = await Promise.all([import("@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult"), import("@/features/usageLimitRecoveryFeatureGate")]);
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      const normalizedIssueFingerprint = typeof issueFingerprint === 'string' ? issueFingerprint.trim() : '';
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'consumeResetCredit', {
        sessionId,
        operation: 'consume_reset_credit',
        ...(normalizedAgentId.length > 0 ? { agentId: normalizedAgentId } : {}),
        ...(normalizedIssueFingerprint.length > 0 ? { issueFingerprint: normalizedIssueFingerprint } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      });
    },
  };
}
