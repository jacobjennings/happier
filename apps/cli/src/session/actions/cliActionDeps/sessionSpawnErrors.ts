import { type SessionSpawnNewIncompatibleTargetV1 } from '@happier-dev/protocol/sessions/creation/sessionSpawnNewResultV1';
import type { SessionSpawnNewResultV1 } from '@happier-dev/protocol';
import { SessionAccessErrorCodeV1Schema } from '@happier-dev/protocol/sessions/access/sessionAccessOperationsV1';
import { SessionInitialAccessEnvelopeHostError } from '@/api/session/sessionCreationInitialAccess';
export type SessionSpawnNewErrorResult = Extract<SessionSpawnNewResultV1, Readonly<{ type: 'error' }>>;

export function incompatibleSessionSpawnTarget(reason: SessionSpawnNewIncompatibleTargetV1['reason']): Readonly<{ type: 'error'; code: 'incompatible_target'; retryable: false; incompatibleTarget: Readonly<{ reason: SessionSpawnNewIncompatibleTargetV1['reason'] }> }> {
  return { type: 'error', code: 'incompatible_target', retryable: false, incompatibleTarget: { reason } } as const satisfies SessionSpawnNewErrorResult;
}

/**
 * Keeps physical-host and atomic-create initial-access failures on the strict spawn
 * settlement instead of erasing Lane 04/Lane 06 recovery meaning behind a
 * generic process failure. The projection carries no key or response body.
 */
export function projectSessionInitialAccessEnvelopeHostErrorResult(
  error: unknown,
): SessionSpawnNewErrorResult | null {
  const code = error instanceof SessionInitialAccessEnvelopeHostError
    ? error.code
    : error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
  const parsedSessionAccessError = SessionAccessErrorCodeV1Schema.safeParse(code);
  if (parsedSessionAccessError.success) {
    return {
      type: 'error',
      code: parsedSessionAccessError.data,
      retryable: false,
    };
  }
  switch (code) {
    case 'not_authenticated':
      return { type: 'error', code: 'permission_denied', retryable: false };
    case 'session_data_key_unavailable':
      return { type: 'error', code, retryable: false };
    case 'session_access_request_failed':
      return { type: 'error', code, retryable: true };
    case 'unsupported_action':
      return incompatibleSessionSpawnTarget('initial_access_unsupported');
    default:
      return null;
  }
}
