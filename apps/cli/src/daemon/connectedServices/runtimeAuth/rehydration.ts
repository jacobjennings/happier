import { normalizeOptionalString, normalizeNullableGeneration } from '@/daemon/connectedServices/sessionAuthSwitch/targets';
import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import { logger } from '@/ui/logger';
import type { ConnectedAccountServiceKey, SessionConnectedServiceAuthReadRuntimeIdentityResponseV1 } from '@happier-dev/protocol';
import { createSessionConnectedServiceAuthTransport } from '@/session/runtime/control/transport';
import type { TrackedSession } from "@/daemon/types";
import type { ConnectedServiceQuotasCoordinator } from "@/daemon/connectedServices/quotas/ConnectedServiceQuotasCoordinator";
import type { ConnectedServiceAccountTransitionVerificationResult } from "@/daemon/connectedServices/runtimeAuth/types";
import { type ConnectedServiceAccountAdoptionVerifier } from "@/daemon/connectedServices/sessionAuthSwitch/sessionConnectedServiceAccountAdoptionVerification";
import { readConnectedServiceChildSelectionsFromEnv } from "@/daemon/connectedServices/connectedServiceChildEnvironment";
import { parseConnectedServiceBindingSelections } from "@/daemon/connectedServices/parseConnectedServicesBindings";
import { resolveTrackedConnectedServiceBindingsRaw } from "@/daemon/connectedServices/trackedSessionConnectedServiceBindings";

type RuntimeIdentityReconnectProbeTarget = Readonly<{
  serviceId: ConnectedAccountServiceKey;
  expected: Readonly<{
    groupId?: string;
    profileId?: string;
    generation?: number;
  }>;
  fallbackGroupId: string | null;
  fallbackProfileId: string;
  fallbackGeneration: number | null;
}>;

function resolveRuntimeIdentityReconnectProbeTargets(
  tracked: TrackedSession,
): RuntimeIdentityReconnectProbeTarget[] {
  const selections = parseConnectedServiceBindingSelections(
    resolveTrackedConnectedServiceBindingsRaw(tracked),
  );
  if (selections.length === 0) return [];

  const childSelections = readConnectedServiceChildSelectionsFromEnv(
    tracked.spawnOptions?.environmentVariables ?? {},
  );
  const targets: RuntimeIdentityReconnectProbeTarget[] = [];
  for (const selection of selections) {
    if (selection.kind === 'profile') {
      targets.push({
        serviceId: selection.serviceId,
        expected: { profileId: selection.profileId },
        fallbackGroupId: null,
        fallbackProfileId: selection.profileId,
        fallbackGeneration: null,
      });
      continue;
    }

    // A Team-resource selection has no local profile/group runtime identity
    // to reconnect against; only profile and group selections probe.
    if (selection.kind !== 'group') continue;

    const childSelection = childSelections?.get(selection.serviceId);
    const matchingChildSelection =
      childSelection?.kind === 'group' &&
      childSelection.groupId === selection.groupId
        ? childSelection
        : null;
    const fallbackProfileId =
      normalizeOptionalString(matchingChildSelection?.activeProfileId) ||
      normalizeOptionalString(selection.fallbackProfileId);
    if (!fallbackProfileId) continue;
    const fallbackGeneration = normalizeNullableGeneration(
      matchingChildSelection?.generation,
    );
    targets.push({
      serviceId: selection.serviceId,
      expected: {
        groupId: selection.groupId,
        profileId: fallbackProfileId,
        ...(fallbackGeneration === null
          ? {}
          : { generation: fallbackGeneration }),
      },
      fallbackGroupId: selection.groupId,
      fallbackProfileId,
      fallbackGeneration,
    });
  }
  return targets;
}

export async function rehydrateConnectedServiceRuntimeIdentityForSessionReport(
  input: Readonly<{
    credentials: Parameters<
      typeof createSessionConnectedServiceAuthTransport
    >[0]['credentials'];
    quotaCoordinator: ConnectedServiceQuotasCoordinator | null;
    sessionId: string;
    tracked: TrackedSession | null;
  }>,
): Promise<void> {
  const sessionId = normalizeOptionalString(input.sessionId);
  const quotaCoordinator = input.quotaCoordinator;
  if (!sessionId || !quotaCoordinator || !input.tracked || !input.credentials)
    return;

  const targets = resolveRuntimeIdentityReconnectProbeTargets(input.tracked);
  if (targets.length === 0) return;

  const transport = createSessionConnectedServiceAuthTransport({
    credentials: input.credentials,
    sessionId,
  });
  let recordedExactIdentity = false;
  for (const target of targets) {
    let result: Awaited<
      ReturnType<typeof transport.readConnectedServiceRuntimeIdentity>
    >;
    try {
      result = await transport.readConnectedServiceRuntimeIdentity({
        serviceId: target.serviceId,
        reason: 'diagnostic',
        requireExactProof: true,
        expected: target.expected,
      });
    } catch (error) {
      logger.debug(
        '[DAEMON RUN] Connected-service runtime identity reconnect probe failed (non-fatal)',
        {
          sessionId,
          serviceId: target.serviceId,
          error: serializeAxiosErrorForLog(error),
        },
      );
      continue;
    }
    if (!result.ok) continue;

    const response: SessionConnectedServiceAuthReadRuntimeIdentityResponseV1 =
      result.value;
    if (!response.ok || response.serviceId !== target.serviceId) continue;
    if (response.identity.proofStrength !== 'exact') continue;
    if (response.runtime?.safeToProbe === false) continue;
    if (response.identity.strategy !== 'provider_account_id') continue;

    const providerAccountId = normalizeOptionalString(
      response.identity.providerAccountId,
    );
    const profileId =
      normalizeOptionalString(response.runtime?.profileId) ||
      target.fallbackProfileId;
    if (!providerAccountId || !profileId) continue;

    quotaCoordinator.recordRuntimeAccountIdentityFromSnapshot({
      sessionId,
      serviceId: target.serviceId,
      groupId:
        normalizeOptionalString(response.runtime?.groupId) ||
        target.fallbackGroupId,
      profileId,
      providerAccountId,
      accountLabel:
        normalizeOptionalString(response.identity.accountLabel) || null,
      observedAtMs: Date.now(),
      source: 'runtime_identity_probe',
      proofStrength: 'exact',
      groupGeneration:
        response.runtime?.generation === undefined
          ? target.fallbackGeneration
          : normalizeNullableGeneration(response.runtime.generation),
    });
    recordedExactIdentity = true;
  }

  if (!recordedExactIdentity) {
    quotaCoordinator.invalidateRuntimeAccountIdentityForSession(sessionId);
  }
  await quotaCoordinator.flushInBandQuotaPersistence(0);
}

export function recordRuntimeAccountIdentityFromVerification(
  input: Readonly<{
    quotaCoordinator: ConnectedServiceQuotasCoordinator | null;
    verificationInput: Parameters<ConnectedServiceAccountAdoptionVerifier>[0];
    result: ConnectedServiceAccountTransitionVerificationResult;
    observedAtMs: number;
  }>,
): void {
  const sessionId = normalizeOptionalString(input.verificationInput.sessionId);
  if (!sessionId) return;
  const quotaCoordinator = input.quotaCoordinator;
  if (!quotaCoordinator) return;

  const providerAccountId =
    input.result.status === 'verified'
      ? normalizeOptionalString(input.result.providerAccountId)
      : '';
  const profileId = normalizeOptionalString(
    input.verificationInput.target.profileId,
  );
  if (!providerAccountId || !profileId) {
    quotaCoordinator.invalidateRuntimeAccountIdentityForSession(sessionId);
    return;
  }

  const groupId = normalizeOptionalString(
    input.verificationInput.target.groupId,
  );
  const selection = readConnectedServiceChildSelectionsFromEnv(
    input.verificationInput.tracked.spawnOptions?.environmentVariables ?? {},
  )?.get(input.verificationInput.serviceId);
  quotaCoordinator.recordRuntimeAccountIdentityFromSnapshot({
    sessionId,
    serviceId: input.verificationInput.serviceId,
    groupId: groupId || null,
    profileId,
    providerAccountId,
    accountLabel: null,
    observedAtMs: input.observedAtMs,
    source: 'active_account_verification',
    proofStrength: 'exact',
    groupGeneration:
      selection?.kind === 'group' && selection.groupId === groupId
        ? selection.generation
        : null,
  });
}
