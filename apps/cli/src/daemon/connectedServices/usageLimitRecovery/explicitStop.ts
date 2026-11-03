import { tryReadSessionMetadataRecord } from '@/daemon/connectedServices/sessionAuthSwitch/persistedState';
import { logger } from '@/ui/logger';
import { updateSessionMetadataWithRetry } from '@/session/metadata/updateSessionMetadataWithRetry';
import { fetchSessionByIdCompat } from '@/session/transport/http/sessionsHttp';
import { fetchAccountEncryptionCurrentness } from '@/api/client/connectedServiceCredentialApi';
import { cancelLatestUsageLimitRecoveryInMetadataAfterExplicitStop, persistUsageLimitRecoveryFieldDurably } from '@/session/usageLimitRecoveryControls/persistUsageLimitRecoveryFieldDurably';
import type { DaemonSessionMutationCustody } from "@/daemon/connectedServices/usageLimitRecovery/createDaemonUsageLimitRecoveryMutationCustody";

export async function persistExplicitSessionStopUsageLimitRecoveryCancellation(
  input: Readonly<{
    credentials: Parameters<
      typeof updateSessionMetadataWithRetry
    >[0]['credentials'];
    sessionId: string;
    mutationCustody: Pick<DaemonSessionMutationCustody, 'stage'>;
    resolveAuthorizationHeaders?: Parameters<typeof fetchSessionByIdCompat>[0]['resolveAuthorizationHeaders'];
  }>,
): Promise<void> {
  const token = input.credentials.token.trim();
  if (!token) return;
  const currentnessHeaders = input.resolveAuthorizationHeaders?.({ method: 'GET', path: '/v1/account/encryption/currentness' });
  if (input.resolveAuthorizationHeaders && !currentnessHeaders) throw new Error('Stop Account currentness authorization unavailable');
  const readStartedAtMs = Date.now();
  const [rawSession, accountEncryptionCurrentness] = await Promise.all([
    fetchSessionByIdCompat({ reason: 'session-control', token, sessionId: input.sessionId,
      ...(input.resolveAuthorizationHeaders ? { resolveAuthorizationHeaders: input.resolveAuthorizationHeaders } : {}),
    }).finally(() => {
      logger.infoFile('[DAEMON STOP] Recovery Session snapshot read completed', {
        sessionId: input.sessionId, elapsedMs: Date.now() - readStartedAtMs,
      });
    }),
    fetchAccountEncryptionCurrentness({ token,
      ...(currentnessHeaders ? { authorizationHeaders: currentnessHeaders } : {}),
    }).finally(() => {
      logger.infoFile('[DAEMON STOP] Recovery Account currentness read completed', {
        sessionId: input.sessionId, elapsedMs: Date.now() - readStartedAtMs,
      });
    }),
  ]);
  if (!rawSession || rawSession.id !== input.sessionId) return;
  const currentMetadata = tryReadSessionMetadataRecord({
    rawSession,
    credentials: input.credentials,
    accountEncryptionMode: accountEncryptionCurrentness.mode,
  });
  if (!currentMetadata) return;
  const nextMetadata =
    cancelLatestUsageLimitRecoveryInMetadataAfterExplicitStop(currentMetadata);
  if (nextMetadata === currentMetadata) return;
  const stagingStartedAtMs = Date.now();
  await persistUsageLimitRecoveryFieldDurably({
    sessionId: input.sessionId,
    currentMetadata,
    nextMetadata,
    mode: 'cancel',
    stageUsageLimitRecoveryMutation: async (mutation) => {
      await input.mutationCustody.stage({ mutation, rawSession });
    },
  });
  logger.infoFile('[DAEMON STOP] Recovery cancellation durable staging completed', {
    sessionId: input.sessionId, elapsedMs: Date.now() - stagingStartedAtMs,
  });
}
