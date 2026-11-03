import fastify from 'fastify';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { createAuthoredAdmittedPluginRuntimeFixture } from '@/plugins/testkit/admittedRuntime';
import { createPluginManifestV2Fixture } from '@/plugins/testkit/manifestV2Fixture';
import { createDaemonControlAuthGuard } from '@/daemon/controlAuth';
import { readDaemonPluginCatalog } from '@/daemon/controlClient';
import { PLUGIN_CATALOG_READ_PATH, registerDaemonPluginChangeRoutes } from './controlRoutes';
import { readCurrentDaemonPluginCatalogSnapshot } from './currentCatalog';
import { resolvePluginStorePaths } from '@/plugins/store/paths';

// Prepared UI byte graphs are a filesystem boundary unrelated to executable
// tool selection. Source declarations can precede their UI artifact build.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (String(args[0]).replaceAll('\\', '/').endsWith('/dist/happier-plugin-ui/ui-artifacts.json')) {
      throw Object.assign(new Error('UI artifacts are not prepared in this fixture'), { code: 'ENOENT' });
    }
    return actual.readFileSync(...args);
  } };
});

function toolPlugin() {
  return {
    manifest: createPluginManifestV2Fixture({ id: 'acme.tools', contributes: {
      actions: [{ id: 'echo', title: 'Echo', scopes: ['global'], surfaces: ['agent', 'mcp'],
        execution: { target: 'daemon' }, dangerLevel: 'safe', inputSchema: { type: 'object' } }],
      tools: [{ id: 'echo-tool', name: 'acme_echo', title: 'Echo', action: 'echo', surfaces: ['agent', 'mcp'] }],
    } }),
    files: { 'daemon.mjs': 'export function activate(api) { api.actions.register("echo", async () => ({ok: true})); }' },
  };
}

it('reads executable tools without projecting display declarations, while observing retirement', async () => {
  // The bundled catalog is joined around one eagerly activated daemon target,
  // so retirement is observed on an actual activation target.
  const fixture = await createAuthoredAdmittedPluginRuntimeFixture({ plugins: [toolPlugin()] });
  try {
    const params = { reloadController: fixture.controller, happyHomeDir: fixture.happyHomeDir };
    const full = await readCurrentDaemonPluginCatalogSnapshot(params);
    const readTools = () => readCurrentDaemonPluginCatalogSnapshot({ ...params, selection: 'tools' as const });
    expect(full.tools).toHaveLength(1);
    const snapshot = await readTools();
    expect(snapshot.plugins.length).toBe(0);
    expect(snapshot.tools).toEqual(full.tools);
    // Retire an actual activation target; data-only entries can carry a generation too.
    const activeTargetIds = new Set(fixture.registry.targetActivationFacts
      .flatMap(fact => fact.status === 'active' ? [fact.pluginId] : []));
    const applied = full.plugins.find(entry => (
      entry.appliedGeneration !== null && activeTargetIds.has(entry.pluginId)
    ));
    expect(applied).toBeDefined();
    await fixture.registry.recordPluginActivationFailure?.(applied!.pluginId, 'tool-selection retirement');
    expect((await readCurrentDaemonPluginCatalogSnapshot(params)).plugins
      .find(entry => entry.pluginId === applied!.pluginId)?.appliedGeneration).toBeNull();
    expect((await readTools()).tools).toEqual([]);
  } finally {
    await fixture.dispose();
  }
}, 180_000);

it('serves fresh occurrence-bound tools through the authenticated catalog route', async () => {
  const fixture = await createAuthoredAdmittedPluginRuntimeFixture({ plugins: [toolPlugin()] });
  const app = fastify();
  const projection = { runtimeId: 'catalog-route-fixture', contributionRegistryProjectionRevision: 1 };
  try {
    registerDaemonPluginChangeRoutes(app, {
      requireAuth: createDaemonControlAuthGuard('fixture-token'),
      service: {
        requestPluginChange: async () => { throw new Error('Unexpected mutation'); },
        decidePluginChange: async () => { throw new Error('Unexpected mutation'); },
        statusPluginChange: async () => ({ kind: 'expired' }),
        listPendingPluginChanges: async () => ({ changes: [] }),
        shutdown: async () => {},
      },
      readCatalogProjection: () => projection,
      readCatalogSnapshot: request => readCurrentDaemonPluginCatalogSnapshot({
        reloadController: fixture.controller, happyHomeDir: fixture.happyHomeDir,
        selection: request?.selection,
      }),
    });
    const read = (selection?: string, authenticated = true) => app.inject({
      method: 'POST', url: PLUGIN_CATALOG_READ_PATH,
      headers: authenticated ? { 'x-happier-daemon-token': 'fixture-token' } : {},
      payload: selection ? { selection } : {},
    });
    expect((await read('tools', false)).statusCode).toBe(401);
    const full = (await read()).json();
    expect(full.tools).toHaveLength(1);
    const selected = (await read('tools')).json();
    expect(selected.plugins.length).toBe(0);
    expect(selected.tools).toEqual(full.tools);
    expect(selected.projection).toEqual(projection);
    expect(selected.tools[0].expectedContributorOccurrenceId).toBeTruthy();
    // The serving controller already observed this durable revision. Tools must
    // not reopen the administrative installation/rollback snapshot on each read.
    const currentPath = resolvePluginStorePaths({ happyHomeDir: fixture.happyHomeDir }).registryCurrentFilePath;
    const currentBytes = await readFile(currentPath);
    try {
      await writeFile(currentPath, '{invalid fixture snapshot');
      const withoutDisplayDisk = await read('tools');
      expect(withoutDisplayDisk.statusCode).toBe(200);
      expect(withoutDisplayDisk.json().tools).toEqual(selected.tools);
      expect((await read()).statusCode).toBe(500);
    } finally {
      await writeFile(currentPath, currentBytes);
    }
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing catalog HTTP port');
    const transported = await readDaemonPluginCatalog({ selection: 'tools', target: {
      pid: process.pid, httpPort: address.port, controlToken: 'fixture-token',
    } });
    expect(transported).toEqual(selected);
    await fixture.registry.recordPluginActivationFailure?.('acme.tools', 'tool source retired');
    projection.contributionRegistryProjectionRevision += 1;
    const retired = (await read('tools')).json();
    expect(retired.tools).toEqual([]);
    expect(retired.projection.contributionRegistryProjectionRevision).toBe(2);
    expect((await read('invalid')).statusCode).toBe(400);
    console.info('selected tool route bytes', JSON.stringify({full: Buffer.byteLength(JSON.stringify(full)),
      selected: Buffer.byteLength(JSON.stringify(selected)), retired: Buffer.byteLength(JSON.stringify(retired))}));
  } finally {
    await app.close();
    await fixture.dispose();
  }
}, 180_000);
