import { afterEach, describe, expect, it, vi } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildCodexAppServerConfigOverrides } from '@happier-dev/plugins-codex/agent/runtime/appServer/config/overrides';
import { accountSettingsParse } from '@happier-dev/protocol';

import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { createHappierMcpBridge } from '@/agent/runtime/createHappierMcpBridge';
import type { HappyMcpSessionClient } from '@/mcp/startHappyServer';

const originalSourceEntrypointFlag = process.env.HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT;
const daemonCatalogBoundary = vi.hoisted(() => ({
  read: vi.fn(async () => ({ kind: 'available' as const, plugins: [], tools: [] })),
}));

vi.mock('@/daemon/controlClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/daemon/controlClient')>();
  // Daemon IPC is the external boundary. No plugin Action matches these
  // built-in reads; retain their real host executor instead of requiring a daemon.
  return { ...actual, readDaemonPluginCatalog: daemonCatalogBoundary.read,
    requestDaemonPluginActionExecution: async () => ({ matched: false }) };
});

function expectCodexHappierBridgeWiring(overrides: readonly string[]): void {
  expect(overrides).toEqual(expect.arrayContaining([
    'mcp_servers.happier.enabled=true',
    'mcp_servers.happier.startup_timeout_sec=60',
    'mcp_servers.happier.tools.action_spec_search.approval_mode="approve"',
  ]));
  expect(overrides.some((override) => override.startsWith('mcp_servers.happier.command='))).toBe(true);
  expect(overrides.some((override) => override.startsWith('mcp_servers.happier.args='))).toBe(true);
}

describe('Happier MCP → Codex composed wiring', () => {
  afterEach(() => {
    if (originalSourceEntrypointFlag === undefined) {
      delete process.env.HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT;
    } else {
      process.env.HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT = originalSourceEntrypointFlag;
    }
  });

  it.each(['default', 'direct'] as const)('exposes the real Action catalog through Codex with %s exposure', async (exposure) => {
    process.env.HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT = '1';
    const sessionId = 'sess_mcp_codex_composed_1';
    let admitted = false;
    const session: HappyMcpSessionClient = {
      sessionId,
      getServerBinding: () => ({ serverId: 'test-home', serverUrl: 'https://test-home.example.test' }),
      rpcHandlerManager: new RpcHandlerManager({
        scopePrefix: sessionId,
        encryptionKey: new Uint8Array([1, 2, 3, 4]),
        encryptionVariant: 'legacy',
      }),
      updateMetadata: () => undefined,
      getMetadataSnapshot: () => ({ work: { memoryEnabled: true } }),
      // Host admission is the input boundary to this MCP transport composition.
      // Listing tools is turn-neutral; invoking them needs the host's live facts.
      getWorkDepth: () => 0,
      getHostTurnWorkDepth: turnId => admitted && turnId === 'catalog-turn' ? 0 : undefined,
      getActiveTurnPermissionWitness: () => admitted ? { turnId: 'catalog-turn',
        causalPermissionAuthority: { kind: 'admittedSessionInputV1', admittedPermissionCeiling: 'read-only' } } : null,
    };
    const bridge = await createHappierMcpBridge(session, {
      accountSettings: accountSettingsParse(exposure === 'default' ? {} : {
        actionsSettingsV1: {
          v: 1,
          actions: {
            'session.list': {
              disabledSurfaces: [],
              toolExposureModes: { agent: 'direct' },
            },
          },
        },
      }),
    });
    const config = bridge.mcpServers.happier;
    const overrides = buildCodexAppServerConfigOverrides(bridge.mcpServers);
    expectCodexHappierBridgeWiring(overrides);

    // Sensitivity: removing the real server binding must invalidate this seam proof.
    expect(() => expectCodexHappierBridgeWiring(buildCodexAppServerConfigOverrides({}))).toThrow();

    const client = new Client({ name: 'happier-codex-composed-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(new StdioClientTransport({
        command: config.command,
        args: [...(config.args ?? [])],
        env: config.env ? { ...config.env } : undefined,
      }));
      const catalog = await client.listTools();
      const names = catalog.tools.map((tool) => tool.name);

      expect(names).toEqual(expect.arrayContaining([
        'action_spec_search',
        'action_spec_get',
        'action_execute',
      ]));
      expect(names.includes('session_list')).toBe(exposure === 'direct');
      expect(names).not.toContain('session_status_get');
      const refused = CallToolResultSchema.parse(await client.callTool({
        name: 'action_spec_get', arguments: { id: 'session.list' },
      }));
      expect(refused).toMatchObject({ isError: true, content: [
        { type: 'text', text: JSON.stringify({ errorCode: 'target_unavailable', error: 'target_unavailable' }) },
      ] });
      admitted = true;
      // Discoverable-only does not mean absent: use the real MCP transport,
      // catalog, policy and handlers to obtain both operational read schemas.
      for (const id of ['session.list', 'session.status.get']) {
        const result = CallToolResultSchema.parse(await client.callTool({
          name: 'action_spec_get', arguments: { id },
        }));
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        const text = result.content.find(item => item.type === 'text');
        if (!text || text.type !== 'text') throw new Error('Expected a discovery result');
        expect(JSON.parse(text.text)).toMatchObject({ actionSpec: { id, inputSchema: expect.any(Object) } });
      }
      expect(names.every((name) => /^[A-Za-z0-9_.-]+$/u.test(name))).toBe(true);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(names);
    } finally {
      await client.close().catch(() => undefined);
      bridge.happierMcpServer.stop();
    }
  // Codex's bridge startup contract above allows 60s; source-entrypoint startup
  // on an admitted, busy worker must not be cut off by the former 30s test timer.
  }, 60_000);
});
