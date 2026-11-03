import { normalizeOptionalString } from '@/daemon/connectedServices/sessionAuthSwitch/targets';
import { readNonBlankOpaqueIdentifier } from '@happier-dev/protocol/strings/opaqueIdentifier';
import type { TrackedSession } from "@/daemon/types";
import type { SpawnSessionOptions } from '@/session/shared/spawnSessionContract';
import { type TemporaryThrottleResumeSource } from "@/daemon/connectedServices/runtimeAuth/resolveInactiveTemporaryThrottleResumeSource";

export function snapshotTrackedSessionForTemporaryThrottleResume(
  tracked: TrackedSession,
): TrackedSession {
  const {
    childProcess: _childProcess,
    projectSetupOperation: _projectSetupOperation,
    activateConnectedAccountSessionBindingOnCanonicalSession:
      _activateConnectedAccountSessionBindingOnCanonicalSession,
    spawnStartupCanonicalSessionId: _spawnStartupCanonicalSessionId,
    spawnStartupReadinessFailure: _spawnStartupReadinessFailure,
    ...snapshot
  } = tracked;
  return {
    ...snapshot,
    ...(tracked.spawnOptions
      ? { spawnOptions: { ...tracked.spawnOptions } }
      : {}),
  };
}

export function buildTrackedExistingSessionResumeSeed(
  input: Readonly<{
    tracked: TemporaryThrottleResumeSource;
    sessionId: string;
  }>,
): Readonly<{
  spawnOptions: SpawnSessionOptions;
  vendorResumeId: string;
  defaultOptions: SpawnSessionOptions;
}> | null {
  const spawnOptions = input.tracked.spawnOptions;
  if (!spawnOptions || !normalizeOptionalString(spawnOptions.directory))
    return null;

  // Opaque Agent identity: cold recovery hands these bytes straight back to
  // the Agent that minted them, so only presence is decided here.
  const resumeFromOptions =
    readNonBlankOpaqueIdentifier(spawnOptions.resume) ?? '';
  const resumeFromTracked =
    readNonBlankOpaqueIdentifier(input.tracked.vendorResumeId) ?? '';
  const {
    resume: _resume,
    sessionId: _sessionId,
    ...spawnOptionsWithoutResume
  } = spawnOptions;

  return {
    spawnOptions,
    vendorResumeId: resumeFromTracked,
    defaultOptions: {
      ...spawnOptionsWithoutResume,
      ...(resumeFromOptions ? { resume: resumeFromOptions } : {}),
      existingSessionId: input.sessionId,
      sessionId: undefined,
      approvedNewDirectoryCreation: true,
    },
  };
}
