import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'socket.io-client';
import axios from 'axios';
import { expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import { MACHINE_ACCESS_LOSS_SERVER_ORIGIN, SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';

import { ApiMachineClient } from '@/api/apiMachine';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { createResolvedContributionRegistry } from '@/plugins/projection/registry/createResolvedContributionRegistry';
import { createPluginReloadController } from '@/plugins/runtime/reload/controller';
import { resolveExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';
import { ConnectedServiceRuntimeRegistry } from '../connectedServices/runtimeRegistry/registry';
import { createDaemonMachineRpcRouteAttachmentCache } from '../machineRpcRouteAttachments';
import { createRequesterSessionControlRuntimeFixture } from '../testkit/requesterSessionControlRuntimeFixture';

// Only the loopback listener and Socket.IO transport are replaced. Startup,
// deferred route attachment, Machine handlers and registration publication stay real.
vi.mock('@/daemon/controlServer', () => ({ startDaemonControlServer: async () => ({ port: 44323, stop: async () => {} }) }));

it('advertises sessionless access-loss custody when the Machine client arrives after startup and is replaced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'happier-access-loss-startup-'));
  let active: ApiMachineClient | null = null;
  const clients: ApiMachineClient[] = [];
  const attachments = createDaemonMachineRpcRouteAttachmentCache({ getApiMachineForSessions: () => active });
  const pluginRuntimeController = createPluginReloadController({
    happyHomeDir: join(directory, 'home'),
    resolveRuntimeRegistry: () => resolveExecutablePluginRuntimeRegistry({
      happyHomeDir: join(directory, 'home'), contributes: createResolvedContributionRegistry({}), pluginIds: [],
    }),
  });
  // Production activates the controller before admitting Machine requests.
  const startupLease = await pluginRuntimeController.acquireRuntimeRegistry();
  await startupLease.release();
  const fixture = await createRequesterSessionControlRuntimeFixture({
    happyHomeDir: join(directory, 'home'), activeServerDir: join(directory, 'home', 'servers', 'custody-home'),
    serverId: 'custody-home', serverHttpBaseUrl: 'https://custody-home.invalid',
    machineId: 'machine-custody', custodianAccountId: 'owner', credentials: { token: 'custody-fixture', encryption: null },
    connectedServicesMaterializationBaseDir: join(directory, 'connected-services'),
    registry: new ConnectedServiceRuntimeRegistry(), trackedSessions: new Map(), getRequester: () => null,
    resolveQualifiedConnectedAccountV4Support: () => 'advertised', getApiMachineForSessions: () => active,
    startup: {
      pluginRuntimeController,
      onMachineAccessLossReceiverReady: attachments.attachMachineAccessLossReceiver,
    },
  });
  const method = `machine-custody:${RPC_METHODS.DAEMON_MACHINE_ACCESS_LOSS}`;
  try {
    // Home HTTP is the external authority. Keep proof creation, request parsing,
    // installed admission and all cleanup owners real beneath that boundary.
    vi.spyOn(axios, 'get').mockImplementation(async url => {
      if (!String(url).endsWith('/v1/account/profile')) throw new Error('Unexpected Home read');
      return { status: 200, data: { id: 'owner' } };
    });
    vi.spyOn(axios, 'post').mockImplementation(async url => {
      if (!String(url).endsWith('/admission/verify')) throw new Error('Unexpected Home mutation');
      return { status: 200, data: { v: 1, ok: true } };
    });
    for (let replacement = 0; replacement < 2; replacement += 1) {
      active = new ApiMachineClient('custody-fixture', { id: 'machine-custody', encryptionMode: 'plain',
        metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0 });
      clients.push(active);
      attachments.attachApiMachineForSessions(active);
      const manager: unknown = Reflect.get(active, 'rpcHandlerManager');
      if (!(manager instanceof RpcHandlerManager)) throw new Error('Missing machine RPC owner');
      const advertised = new Set<string>();
      const socket = {
        auth: { clientType: 'machine-scoped' },
        on() { return socket; },
        emit(event: string, data: { method?: string }) {
          if (event === SOCKET_RPC_EVENTS.REGISTER && data.method) advertised.add(data.method);
          return socket;
        },
      };
      // This models the relay's method-index input, not a manually seeded target.
      manager.onSocketConnect(socket as unknown as Socket);
      expect(advertised.has(method)).toBe(true);
      const request = { method, params: { v: 1, subjectAccountId: 'requester' },
        authorization: MACHINE_ACCESS_LOSS_SERVER_ORIGIN,
        machineAdmission: { actorAccountId: 'owner', custodianAccountId: 'owner',
          machineId: 'machine-custody', installationId: fixture.installation!.installationId,
          role: 'manage' as const, encryptionMode: 'plain' as const } };
      expect(await manager.handleRequest(request)).toEqual({ kind: 'settled' });
      expect(await manager.handleRequest({ ...request, machineAdmission: {
        ...request.machineAdmission, installationId: 'replaced-installation',
      } })).toMatchObject({ errorCode: 'RPC_FORBIDDEN' });
      advertised.clear();
      manager.onSocketConnect(socket as unknown as Socket);
      expect(advertised.has(method)).toBe(true);
      manager.onSocketDisconnect();
    }
  } finally {
    for (const client of clients) client.shutdown();
    await fixture.dispose();
    await pluginRuntimeController.shutdown();
    await rm(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
});
