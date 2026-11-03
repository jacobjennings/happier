import { readBuiltInLegacyConnectedAccountServiceKeyIngress } from '@happier-dev/protocol/connect/connected-service-bindings';
import { type ConnectedServiceSwitchTarget } from "@/daemon/connectedServices/sessionAuthSwitch/connectedServiceSwitchDeferralQueue";
import { type ConnectedServiceRuntimeAuthApplyReason } from "@/daemon/connectedServices/sessionAuthSwitch/switchSessionConnectedServiceAuth";

export function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRuntimeAuthApplyReason(
  value: unknown,
): ConnectedServiceRuntimeAuthApplyReason | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case 'usage_limit':
    case 'soft_threshold':
    case 'same_provider_account_exhausted':
    case 'auth_expired':
    case 'account_changed':
    case 'refresh_failed':
    case 'manual':
    case 'diagnostic':
      return normalized;
    default:
      return undefined;
  }
}

export function normalizeNullableGeneration(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : null;
}

export function normalizeSwitchTarget(
  input: Readonly<{
    serviceId?: string | null;
    profileId?: string | null;
    groupId?: string | null;
    generation?: number | null;
  }>,
): ConnectedServiceSwitchTarget {
  const serviceId = readBuiltInLegacyConnectedAccountServiceKeyIngress(
    input.serviceId,
  );
  if (!serviceId) {
    throw new Error('connected_service_switch_target_service_id_invalid');
  }
  return {
    serviceId,
    profileId: typeof input.profileId === 'string' ? input.profileId : '',
    groupId: typeof input.groupId === 'string' ? input.groupId : '',
    generation:
      typeof input.generation === 'number' && Number.isFinite(input.generation)
        ? Math.max(0, Math.trunc(input.generation))
        : 0,
  };
}
