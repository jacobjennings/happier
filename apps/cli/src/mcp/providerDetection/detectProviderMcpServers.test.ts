import { AGENT_IDS } from '@happier-dev/agents';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';

import { detectProviderMcpServers } from './detectProviderMcpServers';

type DiscoverForDetection = NonNullable<ResolvedExecutablePluginRuntimeRegistry['discoverMcpServersForDetection']>;
type DiscoverySourceFixture = Readonly<{
  pluginId?: string;
  definition: Readonly<{
    id: string;
    title: string;
    loadedInHappierSessions?: boolean;
    metadata?: Readonly<Record<string, unknown>>;
  }>;
}>;

const runtimeLeaseMocks = vi.hoisted(() => ({
  acquireAuthoritativePluginRuntimeRegistryLease: vi.fn(),
}));

vi.mock('@/plugins/runtime/reload/runtimeLease', () => ({
  acquireAuthoritativePluginRuntimeRegistryLease: runtimeLeaseMocks.acquireAuthoritativePluginRuntimeRegistryLease,
}));

/**
 * The production `runtimeRegistry` parameter (passed by the runner, daemon
 * and execution-run callers). Detection reads only its declared discovery
 * sources and the host discovery entry point.
 */
function createRuntimeRegistry(
  sources: readonly DiscoverySourceFixture[],
  discoverMcpServersForDetection?: DiscoverForDetection,
): ResolvedExecutablePluginRuntimeRegistry {
  return {
    contributes: { mcpDiscoverySources: sources },
    ...(discoverMcpServersForDetection ? { discoverMcpServersForDetection } : {}),
  } as unknown as ResolvedExecutablePluginRuntimeRegistry;
}

describe('detectProviderMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeLeaseMocks.acquireAuthoritativePluginRuntimeRegistryLease.mockRejectedValue(
      new Error('the authoritative lease must not be acquired when a runtime registry is supplied'),
    );
  });

  it('uses the authoritative plugin runtime registry lease for discovered providers when no registry is supplied', async () => {
    const release = vi.fn(async () => {});
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async () => ({
      endpoints: [{
        id: 'pi.config.docs',
        name: 'docs',
        kind: 'http',
        url: 'https://mcp.pi.example.test/http',
      }],
    }));
    runtimeLeaseMocks.acquireAuthoritativePluginRuntimeRegistryLease.mockResolvedValue({
      registry: createRuntimeRegistry([{
        pluginId: 'happier.agent.pi',
        definition: {
          id: 'config',
          title: 'Pi MCP discovery',
          loadedInHappierSessions: false,
          metadata: { agentId: 'pi' },
        },
      }], discoverMcpServersForDetection),
      release,
    });

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['pi'],
      env: {},
    });

    expect(runtimeLeaseMocks.acquireAuthoritativePluginRuntimeRegistryLease).toHaveBeenCalledTimes(1);
    expect(discoverMcpServersForDetection).toHaveBeenCalledWith({
      pluginId: 'happier.agent.pi',
      localId: 'config',
      input: { directory: '/tmp/project' },
      signal: expect.any(AbortSignal),
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.servers).toEqual([expect.objectContaining({
      provider: 'pi',
      name: 'docs',
      loadedInHappierSessions: false,
    })]);
  });

  it('does not bind an unowned declaration to another plugin registration with the same local id', async () => {
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async () => ({ endpoints: [] }));

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['pi'],
      env: {},
      runtimeRegistry: createRuntimeRegistry([{
        definition: {
          id: 'pi.synthetic',
          title: 'Unowned Pi MCP discovery',
          metadata: { agentId: 'pi' },
        },
      }], discoverMcpServersForDetection),
    });

    expect(discoverMcpServersForDetection).not.toHaveBeenCalled();
    expect(result.servers).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({
      provider: 'pi',
      code: 'read_failed',
      path: 'plugin:pi.synthetic',
      detail: 'Plugin MCP discovery source is unavailable',
    })]);
  });

  it('activates every declared discovery-provider owner when detection has no provider filter', async () => {
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async () => ({ endpoints: [] }));

    const result = await detectProviderMcpServers({
      directory: null,
      providers: [],
      env: {},
      runtimeRegistry: createRuntimeRegistry([
        {
          pluginId: 'happier.agent.pi',
          definition: { id: 'pi.synthetic', title: 'Pi MCP discovery', metadata: { agentId: 'pi' } },
        },
        {
          pluginId: 'happier.agent.opencode',
          definition: { id: 'opencode.synthetic', title: 'OpenCode MCP discovery', metadata: { agentId: 'opencode' } },
        },
      ], discoverMcpServersForDetection),
    });

    expect(discoverMcpServersForDetection).toHaveBeenCalledTimes(2);
    expect(discoverMcpServersForDetection).toHaveBeenCalledWith(expect.objectContaining({
        pluginId: 'happier.agent.pi',
        localId: 'pi.synthetic',
    }));
    expect(discoverMcpServersForDetection).toHaveBeenCalledWith(expect.objectContaining({
        pluginId: 'happier.agent.opencode',
        localId: 'opencode.synthetic',
    }));
    expect(result.warnings).toEqual([]);
  });

  it('fans out over plugin MCP discovery providers and applies provider filtering generically', async () => {
    const calls: string[] = [];
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async (request) => {
      if (request.localId === 'pi.synthetic') {
        calls.push(`pi:${request.input?.directory ?? ''}`);
        return {
          endpoints: [{
            id: 'pi.config.docs',
            name: 'docs',
            kind: 'http',
            url: 'https://mcp.pi.example.test/http',
          }],
          warnings: [],
        };
      }
      calls.push('opencode');
      return {
        endpoints: [{
          id: 'opencode.config.workspace',
          name: 'workspace',
          kind: 'sse',
          url: 'https://mcp.opencode.example.test/sse',
        }],
        warnings: [],
      };
    });

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['pi'],
      env: {},
      runtimeRegistry: createRuntimeRegistry([
        {
          pluginId: 'happier.agent.pi',
          definition: { id: 'pi.synthetic', title: 'Pi MCP discovery', loadedInHappierSessions: true, metadata: { agentId: 'pi' } },
        },
        {
          pluginId: 'happier.agent.opencode',
          definition: { id: 'opencode.synthetic', title: 'OpenCode MCP discovery', loadedInHappierSessions: true, metadata: { agentId: 'opencode' } },
        },
      ], discoverMcpServersForDetection),
    });

    expect(calls).toEqual(['pi:/tmp/project']);
    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual([{
      provider: 'pi',
      loadedInHappierSessions: true,
      name: 'docs',
      transport: 'http',
      remote: {
        url: 'https://mcp.pi.example.test/http',
        headers: [],
      },
      envKeys: [],
      enabled: null,
      source: {
        kind: 'project',
        path: 'plugin:pi.synthetic',
      },
    }]);
  });

  it('propagates plugin discovery warnings from generic fanout results', async () => {
    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['pi'],
      env: {},
      runtimeRegistry: createRuntimeRegistry([{
        pluginId: 'happier.agent.pi',
        definition: { id: 'pi.synthetic', title: 'Pi MCP discovery', loadedInHappierSessions: true, metadata: { agentId: 'pi' } },
      }], async () => ({
        endpoints: [],
        warnings: [{
          provider: 'pi',
          code: 'parse_failed',
          path: '/tmp/project/.pi/mcp.json',
        }],
      })),
    });

    expect(result.servers).toEqual([]);
    expect(result.warnings).toEqual([{
      provider: 'pi',
      code: 'parse_failed',
      path: '/tmp/project/.pi/mcp.json',
    }]);
  });

  it('bounds a hung plugin discovery provider and continues detecting other providers', async () => {
    let timedOutSignal: AbortSignal | undefined;
    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['pi', 'opencode'],
      env: { HAPPIER_MCP_DISCOVERY_PROVIDER_TIMEOUT_MS: '5' },
      runtimeRegistry: createRuntimeRegistry([
        {
          pluginId: 'happier.agent.pi',
          definition: { id: 'pi.synthetic', title: 'Pi MCP discovery', loadedInHappierSessions: true, metadata: { agentId: 'pi' } },
        },
        {
          pluginId: 'happier.agent.opencode',
          definition: { id: 'opencode.synthetic', title: 'OpenCode MCP discovery', loadedInHappierSessions: true, metadata: { agentId: 'opencode' } },
        },
      ], async (request) => {
        if (request.localId === 'pi.synthetic') {
          timedOutSignal = request.signal;
          return await new Promise(() => {});
        }
        return {
          endpoints: [{
            id: 'opencode.config.workspace',
            name: 'workspace',
            kind: 'sse',
            url: 'https://mcp.opencode.example.test/sse',
          }],
        };
      }),
    });

    expect(result.warnings).toEqual([{
      provider: 'pi',
      code: 'read_failed',
      detail: 'Plugin MCP discovery timed out',
    }]);
    expect(timedOutSignal?.aborted).toBe(true);
    expect(result.servers).toEqual([{
      provider: 'opencode',
      loadedInHappierSessions: true,
      name: 'workspace',
      transport: 'sse',
      remote: {
        url: 'https://mcp.opencode.example.test/sse',
        headers: [],
      },
      envKeys: [],
      enabled: null,
      source: {
        kind: 'project',
        path: 'plugin:opencode.synthetic',
      },
    }]);
  }, 1_000);

  it('rejects endpoint discovery rows that smuggle a transport specification', async () => {
    const endpointWithTransport = {
      id: 'pi.config.env',
      name: 'env',
      kind: 'http' as const,
      url: 'https://mcp.pi.example.test/http',
      transport: {
        kind: 'stdio',
        launch: {
          executable: { kind: 'systemTool', id: 'env-mcp' },
          env: { API_TOKEN: 'secret-value' },
        },
      },
    };

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['pi'],
      env: {},
      runtimeRegistry: createRuntimeRegistry([{
        pluginId: 'happier.agent.pi',
        definition: { id: 'pi.synthetic', title: 'Pi MCP discovery', loadedInHappierSessions: true, metadata: { agentId: 'pi' } },
      }], async () => ({
        endpoints: [endpointWithTransport],
        warnings: [],
      })),
    });

    expect(result.warnings).toEqual([{
      provider: 'pi',
      code: 'unsupported',
      path: 'plugin:pi.synthetic',
    }]);
    expect(result.servers).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('API_TOKEN');
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('drops remote discovery servers with benign URL fragments at the canonical MCP URL boundary', async () => {
    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['pi'],
      env: {},
      runtimeRegistry: createRuntimeRegistry([{
        pluginId: 'happier.agent.pi',
        definition: { id: 'pi.synthetic', title: 'Pi MCP discovery', loadedInHappierSessions: true, metadata: { agentId: 'pi' } },
      }], async () => ({
        endpoints: [{
          id: 'pi.config.fragment',
          name: 'fragment',
          kind: 'http',
          url: 'https://mcp.pi.example.test/http#section',
        }],
        warnings: [],
      })),
    });

    expect(result.servers).toEqual([]);
    expect(result.warnings).toEqual([{
      provider: 'pi',
      code: 'unsupported',
      path: 'plugin:pi.synthetic',
    }]);
  });

  it('detects MCP servers for every installed Agent, bundled or externally contributed', async () => {
    const externalAgentId = 'acme.cli';
    const installedAgentIds = [...AGENT_IDS, externalAgentId];
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async (request) => ({
      endpoints: [{
        id: `${request.pluginId}.${request.localId}.docs`,
        name: 'docs',
        kind: 'http' as const,
        url: 'https://mcp.example.test/http',
      }],
    }));

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: [],
      env: {},
      runtimeRegistry: createRuntimeRegistry(installedAgentIds.map((agentId) => ({
        pluginId: `happier.agent.${agentId}`,
        definition: {
          id: 'config',
          title: `${agentId} MCP configuration`,
          metadata: { agentId },
        },
      })), discoverMcpServersForDetection),
    });

    expect(result.servers.map((server) => server.provider)).toEqual(installedAgentIds);
    expect(result.warnings).toEqual([]);
  });

  it('detects MCP servers for a single externally contributed Agent when it is the requested provider', async () => {
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async () => ({
      endpoints: [{
        id: 'acme.config.docs',
        name: 'docs',
        kind: 'http' as const,
        url: 'https://mcp.acme.example.test/http',
      }],
    }));

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['acme.cli'],
      env: {},
      runtimeRegistry: createRuntimeRegistry([
        {
          pluginId: 'happier.agent.acme',
          definition: { id: 'config', title: 'Acme MCP configuration', metadata: { agentId: 'acme.cli' } },
        },
        {
          pluginId: 'happier.agent.claude',
          definition: { id: 'config', title: 'Claude MCP configuration', metadata: { agentId: 'claude' } },
        },
      ], discoverMcpServersForDetection),
    });

    expect(discoverMcpServersForDetection).toHaveBeenCalledTimes(1);
    expect(result.servers).toEqual([expect.objectContaining({ provider: 'acme.cli', name: 'docs' })]);
    expect(result.warnings).toEqual([]);
  });

  it('warns instead of silently dropping a discovery source whose Agent id cannot be resolved', async () => {
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async () => ({ endpoints: [] }));

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: [],
      env: {},
      runtimeRegistry: createRuntimeRegistry([{
        pluginId: 'happier.agent.acme',
        definition: { id: 'config', title: 'Acme MCP configuration' },
      }], discoverMcpServersForDetection),
    });

    expect(discoverMcpServersForDetection).not.toHaveBeenCalled();
    expect(result.servers).toEqual([]);
    expect(result.warnings).toEqual([{
      code: 'unsupported',
      path: 'plugin:config',
      detail: 'Plugin MCP discovery source declares no Agent id (plugin happier.agent.acme)',
    }]);
  });

  it('never borrows an Agent identity from a discovery source local id', async () => {
    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: [],
      env: {},
      runtimeRegistry: createRuntimeRegistry([{
        pluginId: 'happier.agent.acme',
        definition: { id: 'config.servers', title: 'Acme MCP configuration' },
      }], async () => ({
        endpoints: [{
          id: 'config.docs',
          name: 'docs',
          kind: 'http' as const,
          url: 'https://mcp.example.test/http',
        }],
      })),
    });

    expect(result.servers).toEqual([]);
    expect(result.warnings.map((warning) => warning.provider)).toEqual([undefined]);
  });

  it('does not turn an entirely unusable provider filter into an unfiltered detection', async () => {
    const discoverMcpServersForDetection = vi.fn<DiscoverForDetection>(async () => ({ endpoints: [] }));

    const result = await detectProviderMcpServers({
      directory: '/tmp/project',
      providers: ['   '],
      env: {},
      runtimeRegistry: createRuntimeRegistry([{
        pluginId: 'happier.agent.claude',
        definition: { id: 'config', title: 'Claude MCP configuration', metadata: { agentId: 'claude' } },
      }], discoverMcpServersForDetection),
    });

    expect(discoverMcpServersForDetection).not.toHaveBeenCalled();
    expect(result.servers).toEqual([]);
    expect(result.warnings).toEqual([{
      code: 'unsupported',
      detail: 'MCP detection was asked for an unresolvable Agent id',
    }]);
  });

});
