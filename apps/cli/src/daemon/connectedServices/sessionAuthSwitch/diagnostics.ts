import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import { logger } from '@/ui/logger';
import { ConnectedAccountServiceKeySchema } from '@happier-dev/protocol/connect/connected-service-bindings';
import type { ConnectedAccountServiceKey, ConnectedServiceBindingsV2 } from '@happier-dev/protocol';
import { type ConnectedServiceAuthGroupGenerationApplyFailure } from "@/daemon/connectedServices/accountGroups/switching/ConnectedServiceAuthGroupSwitchCoordinator";
import { type ConnectedServiceDaemonRestartDiagnosticInput } from "@/daemon/connectedServices/sessionAuthSwitch/requestConnectedServiceSessionRestartSignal";
import { buildConnectedServiceRestartFailureDiagnostics, type SessionConnectedServiceAuthSwitchDiagnostics, type SessionConnectedServiceAuthSwitchResult } from "@/daemon/connectedServices/sessionAuthSwitch/switchSessionConnectedServiceAuth";

export function buildManualSwitchRestartDiagnostic(
  input: Readonly<{
    sessionId: string;
    agentId: string;
    bindings: ConnectedServiceBindingsV2;
  }>,
): ConnectedServiceDaemonRestartDiagnosticInput {
  for (const [serviceIdRaw, binding] of Object.entries(
    input.bindings.bindingsByServiceId,
  )) {
    if (binding.source !== 'connected') continue;
    const serviceId = ConnectedAccountServiceKeySchema.safeParse(serviceIdRaw);
    if (!serviceId.success) continue;
    return {
      trigger: 'manual_switch',
      sessionId: input.sessionId,
      agentId: input.agentId,
      serviceId: serviceId.data,
      profileId: binding.profileId ?? null,
      groupId: binding.selection === 'group' ? binding.groupId : null,
      reason: 'manual',
    };
  }
  return {
    trigger: 'manual_switch',
    sessionId: input.sessionId,
    agentId: input.agentId,
    reason: 'manual',
  };
}

export function toConnectedServiceAuthSwitchDiagnosticError(error: unknown): string {
  if (error instanceof Error && error.message.trim())
    return error.message.trim();
  const serialized = serializeAxiosErrorForLog(error);
  if (typeof serialized === 'string') return serialized;
  try {
    return JSON.stringify(serialized);
  } catch {
    return String(error);
  }
}

export function attachConnectedServiceAuthSwitchDiagnostics(
  result: SessionConnectedServiceAuthSwitchResult,
  diagnostics: SessionConnectedServiceAuthSwitchDiagnostics | undefined,
): SessionConnectedServiceAuthSwitchResult {
  if (!diagnostics || Object.keys(diagnostics).length === 0) return result;
  return {
    ...result,
    diagnostics: {
      ...(!result.ok ? result.diagnostics : {}),
      ...diagnostics,
    },
  } as SessionConnectedServiceAuthSwitchResult;
}

export function logConnectedServiceAuthSwitchResult(
  input: Readonly<{
    sessionId: string;
    agentId: string;
    serviceIds: readonly string[];
    result: SessionConnectedServiceAuthSwitchResult;
  }>,
): void {
  logger.debug('[DAEMON RUN] Connected-service session auth switch result', {
    sessionId: input.sessionId,
    agentId: input.agentId,
    serviceIds: input.serviceIds,
    ok: input.result.ok,
    ...(input.result.ok
      ? {
          action: input.result.action,
          continuityByServiceId: input.result.continuityByServiceId,
          ...(input.result.verificationByServiceId
            ? { verificationByServiceId: input.result.verificationByServiceId }
            : {}),
        }
      : {
          errorCode: input.result.errorCode,
          serviceId: input.result.serviceId,
          diagnostics: input.result.diagnostics,
        }),
  });
}

export function connectedServiceAuthGroupGenerationApplyFailure(
  input: Readonly<{
    errorCode: string;
    serviceId: ConnectedAccountServiceKey;
    failurePhase: string;
    diagnostics?: ReturnType<typeof buildConnectedServiceRestartFailureDiagnostics>;
  }>,
): ConnectedServiceAuthGroupGenerationApplyFailure {
  return {
    ok: false,
    errorCode: input.errorCode,
    serviceId: input.serviceId,
    diagnostics: {
      failurePhase: input.failurePhase,
      ...input.diagnostics,
    },
  };
}
