import { tmpdir } from 'node:os';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionSpawnNewInputV2Schema } from '@happier-dev/protocol/sessions/creation/sessionSpawnNewInputV2';
import { deriveSessionCreationTagV1, SessionCreationKeyV1Schema } from '@happier-dev/protocol/sessions/creation/sessionCreationIdentityV1';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { registerSessionCreationTargetPreparationRpc } from '@/session/creation/registerSessionCreationTargetPreparationRpc';
import { createCliActionDeps } from './createCliActionDeps';

describe('Session spawn Home admission', () => {
  afterEach(() => vi.restoreAllMocks());
  it('refuses a private-origin handoff when the target only advertises ordinary spawn', async () => {
    const request = SessionSpawnNewInputV2Schema.parse({
      executionTarget: { serverId: 'portable-home', machineId: 'target-machine' },
      directory: { kind: 'path', path: tmpdir() },
      agentTarget: { kind: 'agent', identity: { pluginId: 'acme.agent', localId: 'worker' } },
      authoringOrigin: { kind: 'project', accountId: 'source-account',
        workspace: { serverId: 'source-home', workspaceId: 'source-workspace', machineId: 'source-machine', rootPath: '/source/repo' }, page: 'scripts' },
    });
    // Only Home HTTP is replaced: the real capability reader and spawn
    // admission must refuse before target preparation or any native create.
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { machine: {
      id: 'target-machine', revokedAt: null, replacedByMachineId: null,
      operationProtocolCapabilities: { sessionSpawn: { protocolVersions: [1] } },
      operationProtocolCapabilitiesRevision: 1,
    } } });
    const post = vi.spyOn(axios, 'post');
    const deps = createCliActionDeps({
      token: 'fixture-token', credentials: { token: 'fixture-token', encryption: null },
      sessionId: '', mode: 'plain', ctx: null,
      serverId: 'local-profile', serverIdentityId: 'portable-home', serverHttpBaseUrl: 'https://home.test',
    });
    const creationKey = SessionCreationKeyV1Schema.parse('private-origin-capability');
    await expect(deps.sessionSpawnNew({ ...request, creationKey,
      sessionCreationTag: deriveSessionCreationTagV1({ callerCreationNamespace: 'user', creationKey }),
      actionCaller: { kind: 'host' },
    })).resolves.toMatchObject({ type: 'error', code: 'update_required', retryable: false,
      details: { reason: 'session_spawn_authoring_origin_update_required' } });
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
  it('admits a portable Home identity through the registered target preparation and refuses another Home', async () => {
    const rpc = new RpcHandlerManager({ scopePrefix: 'target-machine', encryptionMode: 'plain', logger() {} });
    registerSessionCreationTargetPreparationRpc({ rpcHandlerManager: rpc });
    const lifetime = new AbortController();
    const creationKey = 'channel-thread:router:thread';
    const input = SessionSpawnNewInputV2Schema.parse({
      creationKey,
      executionTarget: { serverId: 'portable-home', machineId: 'target-machine' },
      directory: { kind: 'path', path: tmpdir() },
      agentTarget: { kind: 'agent', identity: { pluginId: 'acme.agent', localId: 'worker' } },
      attestedContext: { externalPrincipalId: 'principal-1', sourceMessageId: 'message-1' },
    });
    const deps = createCliActionDeps({
      token: 'fixture-token', credentials: { token: 'fixture-token', encryption: null },
      sessionId: '', mode: 'plain', ctx: null,
      serverId: 'local-profile', serverIdentityId: 'portable-home', serverHttpBaseUrl: 'https://home.test',
      // Substitute only Machine RPC transport. Registration, request parsing,
      // target filesystem preparation and the CLI admission owner remain real.
      machineActionDirectTargetTransport: { machineId: 'target-machine', invoke: (method, request, options) =>
        rpc.invokeLocal(method, request, { signal: options?.signal }) },
    });
    const preflight = deps.sessionSpawnNewDirectoryApprovalPreflight;
    if (!preflight) throw new Error('Missing Session directory preflight');
    await expect(preflight({ input, signal: lifetime.signal })).resolves.toEqual({ type: 'not_required' });
    await expect(preflight({ input: { ...input, executionTarget: { ...input.executionTarget, serverId: 'local-profile' } },
      signal: lifetime.signal })).resolves.toEqual({ type: 'not_required' });
    await expect(preflight({ input: { ...input, executionTarget: { ...input.executionTarget, serverId: 'other-home' } },
      signal: lifetime.signal })).resolves.toEqual({ type: 'error',
      result: { type: 'error', code: 'target_unavailable', retryable: false } });

    // Home admission must also reach the actual spawn owner's capability gate.
    // A Home HTTP absence is a genuine boundary refusal; no native Session is created.
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 404, data: {} });
    const spawnInput = { ...input, creationKey: SessionCreationKeyV1Schema.parse(creationKey),
      sessionCreationTag: deriveSessionCreationTagV1({ callerCreationNamespace: 'plugin:acme.channels', creationKey }),
      actionCaller: { kind: 'plugin' as const, pluginId: 'acme.channels' }, signal: lifetime.signal };
    await expect(deps.sessionSpawnNew(spawnInput)).resolves.toMatchObject({
      type: 'error', code: 'incompatible_target', retryable: false,
      incompatibleTarget: { reason: 'session_spawn_protocol_unavailable' },
    });
    await expect(deps.sessionSpawnNew({ ...spawnInput,
      executionTarget: { ...input.executionTarget, serverId: 'other-home' } })).resolves.toEqual({
      type: 'error', code: 'target_unavailable', retryable: false,
    });

    // A disconnected registration must not pass on Home equality alone.
    rpc.unregisterHandler(RPC_METHODS.DAEMON_SESSION_CREATION_DIRECTORY_PREFLIGHT);
    await expect(preflight({ input, signal: lifetime.signal })).resolves.toEqual({ type: 'error', result: {
      type: 'error', code: 'incompatible_target', retryable: false,
      incompatibleTarget: { reason: 'target_preparation_invalid_result' },
    } });
  });
});
