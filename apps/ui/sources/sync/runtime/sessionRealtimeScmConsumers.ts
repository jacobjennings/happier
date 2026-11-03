import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { readSessionWorkspaceContext } from '@/sync/domains/session/readSessionWorkspaceContext';
import type { SessionRealtimeScmScope } from '@/sync/domains/session/realtime/sessionRealtimeVisibility';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { resolveProjectMachineScopeId } from '@/sync/runtime/orchestration/projectManager';
import { isSessionPathWithinRepoRoot } from '@/scm/sync/paths';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';

type SessionRealtimeScmScopeState = Readonly<{
  sessions?: Readonly<Record<string, Readonly<{ metadata?: unknown; metadataLayoutVersion?: number; ownerMetadataView?: unknown }>>>;
  getProjectForSession?: (sessionId: string) => { key?: { machineId?: string | null; path?: string | null } } | null;
  getSessionProjectScmSnapshot?: (sessionId: string) => ScmWorkingSnapshot | null;
}>;

/**
 * The Session a SCM scope is built for. `serverId` is absent only on the legacy unscoped
 * callers that never learned a Home; every mounted surface supplies one.
 */
export type SessionScmScopeAddress =
  | SessionAddress
  | Readonly<{ serverId?: string | null; sessionId: string }>;

type MountedScmConsumerResetListener = () => void;

let nextConsumerId = 1;
const mountedScmConsumerScopes = new Map<number, SessionRealtimeScmScope>();
const mountedScmConsumerResetListeners = new Set<MountedScmConsumerResetListener>();
const mountedScmConsumerChangeListeners = new Set<() => void>();
let mountedScmConsumerResetVersion = 0;

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readMachineScopeId(
  state: SessionRealtimeScmScopeState,
  sessionId: string,
  session: Readonly<{ metadata?: unknown; metadataLayoutVersion?: number; ownerMetadataView?: unknown }>,
): string | null {
  const workspaceContext = readSessionWorkspaceContext(state, sessionId);
  return normalizeText(workspaceContext.projectMachineId)
    ?? normalizeText(resolveProjectMachineScopeId(readSessionOwnerMetadataView(session) ?? {}));
}

export function buildSessionRealtimeScmScopeFromSnapshot(
  state: SessionRealtimeScmScopeState,
  address: SessionScmScopeAddress,
  snapshot: ScmWorkingSnapshot | null | undefined,
): SessionRealtimeScmScope | null {
  const sessionId = address.sessionId;
  const session = state.sessions?.[sessionId];
  if (!session || snapshot?.repo.isRepo !== true) return null;
  const repoRoot = normalizeText(snapshot.repo.rootPath);
  if (!repoRoot) return null;
  const machineScopeId = readMachineScopeId(state, sessionId, session);
  if (!machineScopeId || machineScopeId === 'unknown') return null;
  return {
    serverId: normalizeText(address.serverId),
    sessionId,
    canonicalProjectKey: normalizeText(snapshot.projectKey) ?? `${machineScopeId}:${repoRoot}`,
    machineScopeId,
    repoRoot,
  };
}

export function resolveSessionRealtimeScmScopeForMountedConsumers(
  state: SessionRealtimeScmScopeState,
  address: SessionScmScopeAddress,
  mountedScopes: ReadonlyArray<SessionRealtimeScmScope>,
): SessionRealtimeScmScope | null {
  const sessionId = address.sessionId;
  const serverId = normalizeText(address.serverId);
  const snapshotScope = buildSessionRealtimeScmScopeFromSnapshot(
    state,
    address,
    state.getSessionProjectScmSnapshot?.(sessionId) ?? null,
  );
  if (snapshotScope) return snapshotScope;

  const session = state.sessions?.[sessionId];
  if (!session) return null;
  const machineScopeId = readMachineScopeId(state, sessionId, session);
  if (!machineScopeId || machineScopeId === 'unknown') return { serverId, sessionId };

  const workspacePath = normalizeText(readSessionWorkspaceContext(state, sessionId).workspacePath);
  if (!workspacePath) return { serverId, sessionId, machineScopeId };

  for (const mountedScope of mountedScopes) {
    if (normalizeText(mountedScope.machineScopeId) !== machineScopeId) continue;
    const repoRoot = normalizeText(mountedScope.repoRoot);
    const canonicalProjectKey = normalizeText(mountedScope.canonicalProjectKey);
    if (!repoRoot || !canonicalProjectKey) continue;
    if (!isSessionPathWithinRepoRoot(workspacePath, repoRoot)) continue;
    return {
      serverId,
      sessionId,
      canonicalProjectKey,
      machineScopeId,
      repoRoot,
    };
  }

  return { serverId, sessionId, machineScopeId };
}

export function registerSessionRealtimeScmConsumerScope(scope: SessionRealtimeScmScope): () => void {
  const consumerId = nextConsumerId;
  nextConsumerId += 1;
  mountedScmConsumerScopes.set(consumerId, {
    ...scope,
    needsMutationTranscript: true,
  });
  for (const listener of mountedScmConsumerChangeListeners) listener();
  return () => {
    if (mountedScmConsumerScopes.delete(consumerId)) {
      for (const listener of mountedScmConsumerChangeListeners) listener();
    }
  };
}

export function subscribeMountedSessionRealtimeScmConsumerScopes(listener: () => void): () => void {
  mountedScmConsumerChangeListeners.add(listener);
  return () => { mountedScmConsumerChangeListeners.delete(listener); };
}

export function readMountedSessionRealtimeScmConsumerScopes(): SessionRealtimeScmScope[] {
  return Array.from(mountedScmConsumerScopes.values());
}

export function getMountedSessionRealtimeScmConsumerScopeResetVersion(): number {
  return mountedScmConsumerResetVersion;
}

export function subscribeMountedSessionRealtimeScmConsumerScopeResets(
  listener: MountedScmConsumerResetListener,
): () => void {
  mountedScmConsumerResetListeners.add(listener);
  return () => {
    mountedScmConsumerResetListeners.delete(listener);
  };
}

export function clearMountedSessionRealtimeScmConsumerScopes(): void {
  const hadConsumers = mountedScmConsumerScopes.size > 0;
  mountedScmConsumerScopes.clear();
  mountedScmConsumerResetVersion += 1;
  for (const listener of mountedScmConsumerResetListeners) {
    listener();
  }
  if (hadConsumers) for (const listener of mountedScmConsumerChangeListeners) listener();
}
