import axios from 'axios';
import { access, readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { z } from 'zod/mini';
import { SessionMetadataTuplePatchV1Schema } from '@happier-dev/protocol';
import { MachineInstallationProofV1Schema, verifyMachineInstallationProof } from '@happier-dev/protocol/machines/identity/installationIdentity';
import { SocketRpcMachineAdmissionContextV1Schema } from '@happier-dev/protocol/machines/machineAccessV1';
import { createProjectSessionRuntimeFixture } from '../testkit/projectSessionRuntimeFixture';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { listRequesterSessionCredentialBindings } from '../sessionEncryption/requesterSessionCredentials';
import { readSessionMarkerForPid, writeSessionMarker } from '../sessionRegistry';
import { publishOrphanedStartupSessionEnds } from './publishOrphanedStartupSessionEnds';
import { retireOrphanedTerminalControlServiceability } from './retireOrphanedTerminalControlServiceability';

it.each(['entitled', 'withdrawn', 'ambiguous', 'preparing-successor', 'wrong-home'] as const)(
  'preserves requester credential custody while retiring an %s orphan', async state => {
    const f = await createProjectSessionRuntimeFixture({ boundSessionId: 'orphan',
      machineAccess: { custodianAccountId: 'custodian', role: 'use' } });
    const bootstrap = f.bootstrap;
    const pid = 999_312_859;
    const marker = { sessionId: 'orphan', pid, processStartTimeMs: 123,
      requesterWorkAttributionV1: state === 'wrong-home' ? { ...bootstrap.attribution, serverId: 'other-home' } : bootstrap.attribution };
    await writeSessionMarker({ pid, happySessionId: marker.sessionId, startedBy: 'daemon',
      processStartTimeMs: marker.processStartTimeMs, requesterWorkAttributionV1: bootstrap.attribution });
    const existingGet = vi.mocked(axios.get).getMockImplementation();
    vi.mocked(axios.get).mockImplementation(async (url, config) => {
      if (String(url).endsWith('/v1/access-keys/orphan/machine')) return { status: 200, data: { accessKey: { data: 'opaque' } } };
      if (String(url).endsWith('/v2/sessions/orphan')) return { status: 200, data: { session: createSessionRecordFixture({
        id: 'orphan', encryptionMode: 'plain', metadataLayoutVersion: 0, metadataVersion: 1,
        metadata: JSON.stringify({ machineId: 'machine', path: f.directory, hostPid: pid, hostProcessStartTimeMs: 123 }),
      }) } };
      if (!existingGet) throw new Error('Missing Home boundary');
      return existingGet(url, config);
    });
    const custody = await bootstrap.bindExistingSession('orphan');
    if (!custody) throw new Error('Missing actual retained requester custody');
    const before = await readFile(custody.path, 'utf8');
    if (state === 'withdrawn') f.retire();
    const patches: unknown[] = [];
    vi.spyOn(axios, 'patch').mockImplementation(async (_url, body, config) => {
      expect(config?.headers?.Authorization).toBe(`Bearer ${bootstrap.credentials.token}`);
      patches.push(SessionMetadataTuplePatchV1Schema.parse(body));
      return { status: 200, data: { success: true, metadataLayoutVersion: 1,
        sharedMetadata: { version: 2 }, agentState: { version: 0 } } };
    });
    const proofRequests: unknown[] = [];
    vi.spyOn(axios, 'post').mockImplementation(async (url, body) => {
      expect(String(url)).toBe(`${bootstrap.serverHttpBaseUrl}/v1/machines/machine/admission/verify`);
      proofRequests.push(body);
      const request = z.object({ context: SocketRpcMachineAdmissionContextV1Schema, method: z.string(),
        custodySubjectAccountId: z.string(), proof: MachineInstallationProofV1Schema }).parse(body);
      expect(verifyMachineInstallationProof({ payload: { version: 1, machineId: 'machine',
        installationId: f.installation.installationId, accountId: 'custodian', rpcAdmission: {
          context: request.context, method: request.method, custodySubjectAccountId: request.custodySubjectAccountId,
        } }, proof: request.proof, publicKey: f.installation.publicKey })).toBe(true);
      return { status: state === 'withdrawn' ? 200 : 403, data: state === 'withdrawn' ? { v: 1, ok: true } : {} };
    });
    const requester = { bootstrap, isCurrent: bootstrap.isCurrent };
    const params = { marker, happyHomeDir: f.directory, machineId: 'machine', serverId: bootstrap.attribution.serverId,
      serverHttpBaseUrl: bootstrap.serverHttpBaseUrl, encryptionMode: 'plain' as const, credentials: { token: 'custodian-fixture', encryption: null },
      custodianAccountId: 'custodian', isSessionAlreadyRunning: async () => false,
      resolveRequesterSessionRuntimeContext: async () => state === 'ambiguous' || state === 'preparing-successor' || state === 'wrong-home'
        ? null : await bootstrap.isCurrent() ? requester : null,
      releaseRequesterSessionRuntimeContext: async () => undefined };
    const retained = await publishOrphanedStartupSessionEnds({ orphanedDeadDaemonSessions: [marker],
      apiMachine: {
        enqueueDaemonTerminalExactTurnEnd: async () => undefined,
        captureMachineSessionTerminal: async () => ({ v: 1, status: 'captured', sessionId: 'orphan',
          authority: { kind: 'generation', publisherGeneration: '1' } }),
        finalizeMachineSessionTerminal: async () => {
          if (state === 'preparing-successor') {
            // The real launch owner publishes custody before any child or lock exists.
            expect(await bootstrap.bindExistingSession('orphan')).not.toBeNull();
          }
          return { v: 1, status: state === 'preparing-successor' ? 'superseded' : 'closed', sessionId: 'orphan' };
        },
      },
      retireTerminalControlServiceability: async () => retireOrphanedTerminalControlServiceability(params),
    });
    await expect(access(custody.path)).resolves.toBeUndefined();
    expect(await readFile(custody.path, 'utf8')).toBe(before);
    const discovery = await listRequesterSessionCredentialBindings({ happyHomeDir: f.directory,
      serverId: bootstrap.attribution.serverId, machineId: 'machine', installationId: f.installation.installationId });
    expect(discovery).toMatchObject({ status: 'ready', bindings: [{ sessionId: 'orphan', attribution: bootstrap.attribution }] });
    if (state === 'entitled') {
      expect(patches).toHaveLength(1);
      expect(patches[0]).toMatchObject({ target: { ownerMetadata: { t: 'plain', v: {
        runtime: { terminal: { controlServiceabilityV1: { retired: true } } },
      } } } });
      expect(await bootstrap.isCurrent()).toBe(true);
      expect(proofRequests).toHaveLength(0);
    } else if (state !== 'wrong-home') {
      expect(patches).toHaveLength(0);
      expect(proofRequests).toHaveLength(1);
      expect(proofRequests[0]).toMatchObject({ method: 'machine:daemon.machineAccessLoss', custodySubjectAccountId: 'requester',
        context: { actorAccountId: 'custodian', custodianAccountId: 'custodian', machineId: 'machine',
          installationId: f.installation.installationId, role: 'manage', encryptionMode: 'plain' } });
    } else {
      expect(patches).toHaveLength(0);
      expect(proofRequests).toHaveLength(0);
    }
    expect(retained).toEqual(state === 'entitled' || state === 'withdrawn' ? [] : [marker]);
    expect(await readSessionMarkerForPid(pid)).toEqual(state === 'entitled' || state === 'withdrawn' ? null : expect.anything());
  },
);
