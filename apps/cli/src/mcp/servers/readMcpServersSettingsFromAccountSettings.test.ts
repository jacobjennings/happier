import { describe, expect, it } from 'vitest';
import { accountSettingsParse } from '@happier-dev/protocol/account/settings/accountSettings';
import type { McpServerCatalogEntryV1 } from '@happier-dev/protocol';

import { readMcpServersSettingsFromAccountSettings, readMcpServersSettingsForStartup } from './readMcpServersSettingsFromAccountSettings';

function catchRefusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the MCP catalog read to be refused');
}

describe('readMcpServersSettingsFromAccountSettings', () => {
  it('uses the admitted catalog after root removal and keeps strict policy separate', () => {
    const server: McpServerCatalogEntryV1 = { id: 'row-server', name: 'row-server', transport: 'stdio',
      stdio: { command: 'echo', args: ['current'] }, env: {}, createdAt: 1, updatedAt: 1 };
    const out = readMcpServersSettingsFromAccountSettings({
      source: 'network', settings: accountSettingsParse({ mcpServersStrictMode: true }), settingsVersion: 4,
      loadedAtMs: 1, settingsSecretsReadKeys: [], rawSettings: {},
      mcpServerCatalog: { status: 'ready', authority: 'active', revision: 3,
        catalog: { v: 1, servers: [server], bindings: [] }, diagnostics: [] },
    });
    expect(out.servers).toEqual([server]);
    expect(out.strictMode).toBe(true);
  });

  it('refuses an unavailable catalog instead of admitting an empty configuration', () => {
    expect(catchRefusal(() => readMcpServersSettingsFromAccountSettings({
      source: 'network', settings: accountSettingsParse({}), settingsVersion: 4, loadedAtMs: 1,
      settingsSecretsReadKeys: [], rawSettings: {},
      mcpServerCatalog: { status: 'unavailable', reason: 'unreachable' },
    }))).toMatchObject({ code: 'mcp_catalog_unavailable', reason: 'unreachable' });
  });

  it('distinguishes optional unavailability from strict startup refusal without inventing an empty catalog', () => {
    const snapshot = { source: 'network' as const, settings: accountSettingsParse({ mcpServersStrictMode: false }),
      settingsVersion: 4, loadedAtMs: 1, settingsSecretsReadKeys: [], rawSettings: {},
      mcpServerCatalog: { status: 'unavailable' as const, reason: 'unreachable' as const },
    };
    expect(readMcpServersSettingsForStartup({ snapshot })).toMatchObject({
      status: 'unavailable', error: { code: 'mcp_catalog_unavailable', reason: 'unreachable' },
    });
    expect(catchRefusal(() => readMcpServersSettingsForStartup({ snapshot: { ...snapshot,
      settings: accountSettingsParse({ mcpServersStrictMode: true }) }, settings: snapshot.settings,
    }))).toMatchObject({ code: 'mcp_catalog_unavailable', reason: 'unreachable' });
    expect(catchRefusal(() => readMcpServersSettingsForStartup({ snapshot: null,
      settings: accountSettingsParse({ mcpServersStrictMode: true }),
    }))).toMatchObject({ code: 'mcp_catalog_unavailable', reason: 'catalog-unobserved' });
    expect(catchRefusal(() => readMcpServersSettingsForStartup({ snapshot: { ...snapshot,
      mcpServerCatalog: { status: 'unavailable', reason: 'account-mode-mismatch' },
    } }))).toMatchObject({ code: 'mcp_catalog_unavailable', reason: 'account-mode-mismatch' });
  });

  it('admits an observed empty destination', () => {
    const out = readMcpServersSettingsFromAccountSettings({ source: 'network', settings: accountSettingsParse({}),
      settingsVersion: 4, loadedAtMs: 1, settingsSecretsReadKeys: [],
      mcpServerCatalog: { status: 'ready', authority: 'active', revision: 0, diagnostics: [], catalog: { v: 1, servers: [], bindings: [] } } });
    expect(out.v).toBe(1);
    expect(out.strictMode).toBe(false);
    expect(out.servers).toEqual([]);
    expect(out.bindings).toEqual([]);
  });

  it('refuses an unobserved catalog even if a retained root is available', () => {
    expect(catchRefusal(() => readMcpServersSettingsFromAccountSettings({ source: 'network',
      settings: accountSettingsParse({}), settingsVersion: 4, loadedAtMs: 1, settingsSecretsReadKeys: [],
      rawSettings: { mcpServersSettingsV1: { v: 1, strictMode: true, servers: [], bindings: [] } },
    }))).toMatchObject({ code: 'mcp_catalog_unavailable', reason: 'catalog-unobserved' });
  });
});
