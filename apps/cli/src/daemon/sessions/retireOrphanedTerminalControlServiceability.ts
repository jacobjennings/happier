import type { StoredCredentials } from '@/persistence';
import { runWithServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import type { RequesterSessionRuntimeContext } from '../sessionEncryption/requesterSessionCredentials';
import { readMachineRpcAdmissionCurrentOrThrow } from '@/api/machine/machineRpcAuthorization';
import { readInstallationIdentityIfExistsSync } from '../identity/store';
import { RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import type { OrphanedDeadDaemonSession } from './reattachFromMarkers';
import { retireExactTerminalControlServiceability } from './retireTerminalControlServiceability';

/** Reconnect retires the departed runner's control projection after its terminal ACK. */
export async function retireOrphanedTerminalControlServiceability<Context extends Pick<RequesterSessionRuntimeContext, 'bootstrap' | 'isCurrent'>>(params: Readonly<{
  marker: OrphanedDeadDaemonSession;
  serverId: string;
  serverHttpBaseUrl: string;
  machineId: string;
  encryptionMode: 'plain' | 'e2ee';
  credentials: StoredCredentials;
  custodianAccountId: string | null;
  isSessionAlreadyRunning(sessionId: string): Promise<boolean>;
  resolveRequesterSessionRuntimeContext?(sessionId: string, attribution: OrphanedDeadDaemonSession['requesterWorkAttributionV1']): Promise<Context | null>;
  releaseRequesterSessionRuntimeContext?(context: Context): Promise<void>;
}>): Promise<void> {
  const { marker } = params;
  const attribution = marker.requesterWorkAttributionV1;
  const context = await params.resolveRequesterSessionRuntimeContext?.(marker.sessionId, attribution);
  if (attribution && !context) {
    // A missing context is unknown. Only the existing signed Home loss check
    // can release the marker without a requester-owned metadata mutation.
    const installation = readInstallationIdentityIfExistsSync();
    if (attribution.serverId !== params.serverId || attribution.machineId !== params.machineId
      || installation?.installationId !== attribution.installationId || !params.custodianAccountId
      || attribution.accountId === params.custodianAccountId) throw new Error('requester_session_context_unavailable');
    if (await params.isSessionAlreadyRunning(marker.sessionId)) return;
    const withdrawn = await readMachineRpcAdmissionCurrentOrThrow({
      context: { actorAccountId: params.custodianAccountId, custodianAccountId: params.custodianAccountId,
        machineId: params.machineId, installationId: installation.installationId,
        role: 'manage', encryptionMode: params.encryptionMode },
      method: `${params.machineId}:${RPC_METHODS.DAEMON_MACHINE_ACCESS_LOSS}`,
      custodySubjectAccountId: attribution.accountId, privateKey: installation.privateKey,
      daemonToken: params.credentials.token, serverHttpBaseUrl: params.serverHttpBaseUrl,
    });
    if (!withdrawn) throw new Error('requester_session_context_unavailable');
    // Credential lifetime remains with verified access-loss cleanup, including
    // launch preparation that has written custody before a child exists.
    return;
  }
  try {
    const publish = () => retireExactTerminalControlServiceability({
      credentials: context?.bootstrap.credentials ?? params.credentials, sessionId: marker.sessionId,
      terminalMode: 'plain', expectedRunner: { pid: marker.pid, startTimeMs: marker.processStartTimeMs },
      ...(context ? { currentness: { verifyCurrent: () => context.isCurrent() } } : {}) });
    await (context ? runWithServerHttpBaseUrl(context.bootstrap.serverHttpBaseUrl, publish) : publish());
  } finally {
    if (context) await params.releaseRequesterSessionRuntimeContext?.(context);
  }
}
