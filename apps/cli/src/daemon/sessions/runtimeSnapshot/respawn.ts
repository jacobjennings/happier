import { resolveAgentIdFromSessionMetadata, resolveVendorResumeIdFromSessionMetadata } from '@happier-dev/agents';
import type { TrackedSession } from "@/daemon/types";
import type { SpawnSessionOptions } from '@/session/shared/spawnSessionContract';
import { resolveSessionRuntimeSnapshot } from "@/daemon/sessions/runtimeSnapshot/resolveSessionRuntimeSnapshot";

export async function refreshTrackedSessionsRuntimeSnapshot(
  input: Readonly<{
    sessionId: string;
    incomingOptions: SpawnSessionOptions;
    trackedSessions: Iterable<TrackedSession>;
    readPersistedSessionMetadata: (
      sessionId: string,
    ) => Promise<Record<string, unknown> | null>;
  }>,
): Promise<void> {
  const metadata = await input.readPersistedSessionMetadata(input.sessionId);
  if (!metadata) return;

  const agentId = resolveAgentIdFromSessionMetadata(metadata);
  const persistedVendorResumeId = agentId
    ? resolveVendorResumeIdFromSessionMetadata(agentId, metadata)
    : null;

  for (const tracked of input.trackedSessions) {
    if (tracked.happySessionId !== input.sessionId) continue;
    const incomingOptions: SpawnSessionOptions = {
      ...tracked.spawnOptions,
      ...input.incomingOptions,
      existingSessionId: input.sessionId,
    };
    const runtimeSnapshot = resolveSessionRuntimeSnapshot({
      resolutionMode: 'retained_live_process',
      incomingOptions,
      persistedMetadata: metadata,
      persistedVendorResumeId,
      trackedSpawnOptions: tracked.spawnOptions ?? null,
      trackedVendorResumeId: tracked.vendorResumeId ?? null,
    });
    tracked.spawnOptions = runtimeSnapshot.spawnOptions;
    const vendorResumeId = runtimeSnapshot.snapshot.vendorResumeId?.value;
    if (vendorResumeId) {
      tracked.vendorResumeId = vendorResumeId;
    }
  }
}

export async function resolveRespawnSessionOptionsWithRuntimeSnapshot(
  input: Readonly<{
    sessionId: string;
    spawnOptions: SpawnSessionOptions;
    vendorResumeId: string;
    defaultOptions: SpawnSessionOptions;
    readPersistedSessionMetadata: (
      sessionId: string,
    ) => Promise<Record<string, unknown> | null>;
  }>,
): Promise<SpawnSessionOptions> {
  const metadata = await input.readPersistedSessionMetadata(input.sessionId);
  if (!metadata) return input.defaultOptions;

  const agentId = resolveAgentIdFromSessionMetadata(metadata);
  const persistedVendorResumeId = agentId
    ? resolveVendorResumeIdFromSessionMetadata(agentId, metadata)
    : null;

  return resolveSessionRuntimeSnapshot({
    incomingOptions: input.defaultOptions,
    persistedMetadata: metadata,
    persistedVendorResumeId,
    trackedSpawnOptions: input.spawnOptions,
    trackedVendorResumeId: input.vendorResumeId,
  }).spawnOptions;
}
