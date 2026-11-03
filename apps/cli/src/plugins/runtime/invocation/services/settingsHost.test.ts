import { afterEach, expect, it } from 'vitest';
import { accountSettingsParse, sealAccountScopedBlobCiphertext, PLUGIN_ACCOUNT_SETTINGS_ACCOUNT_SCOPED_BLOB_KIND_V1,
    type PluginSettingsContributionV2 } from '@happier-dev/protocol';
import { createPluginAccountActionSettingsService } from '@happier-dev/cli-common/plugins/registration';

import { clearActiveAccountSettingsSnapshot, setActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import type { StoredCredentials } from '@/persistence';
import { createAccountPluginSettingsRecordStorage } from '../../context/accountPluginSettingsRecordStorage';
import { createStablePluginEventsBroker } from './events';
import { createProductionPluginSettingsHostFactory } from './settingsHost';

afterEach(() => clearActiveAccountSettingsSnapshot());

const declaration: PluginSettingsContributionV2 = {
    id: 'preferences', version: 1, title: 'Preferences', scope: 'account', target: { kind: 'plugin' },
    fields: [{ id: 'endpoint', title: 'Endpoint', schema: { type: 'string' }, default: 'https://default.example' }],
    presentation: { sections: [], subagentSections: [] },
};

it.each(['plain', 'e2ee'] as const)('reads captured %s Account Settings through the production host and public read-only projection', async mode => {
    setActiveAccountSettingsSnapshot({ source: 'network', settings: accountSettingsParse({}), settingsVersion: 1,
        loadedAtMs: 1, settingsSecretsReadKeys: [], scopeKey: 'unrelated-ambient-account' });
    let reads = 0;
    const encryption = { type: 'dataKey' as const, publicKey: new Uint8Array(32).fill(1), machineKey: new Uint8Array(32).fill(2) };
    const credentials: StoredCredentials = { token: 'captured-token', encryption: mode === 'plain' ? null : encryption };
    const values = { v: 1, values: { endpoint: 'https://configured.example' } };
    const content = mode === 'plain' ? { t: 'plain', v: values } : { t: 'encrypted', c: sealAccountScopedBlobCiphertext({
        kind: PLUGIN_ACCOUNT_SETTINGS_ACCOUNT_SCOPED_BLOB_KIND_V1,
        material: { type: 'dataKey', machineKey: encryption.machineKey }, payload: values,
        randomBytes: length => new Uint8Array(length).fill(3),
    }) };
    const createHost = createProductionPluginSettingsHostFactory({
        accountScoped: true, broker: createStablePluginEventsBroker(),
        accountSettingsRecordAdapter: createAccountPluginSettingsRecordStorage({
            readCredentials: async () => credentials,
            isCurrentAccount: () => true, resolveBaseUrl: () => 'https://captured.example',
            http: {
                get: async (url, config) => {
                    expect(config.headers).toMatchObject({ Authorization: 'Bearer captured-token' });
                    if (url.endsWith('/encryption')) return { status: 200, data: { mode, updatedAt: 1 } };
                    expect(url).toBe('https://captured.example/v1/account/plugin-settings/acme.plugin');
                    reads++;
                    return { status: 200, data: { status: 'present', revision: 4, content } };
                },
                post: async () => { throw new Error('Account Actions expose Settings reads'); },
            },
        }),
    });
    const settings = createHost([{ pluginId: 'acme.plugin', contribution: declaration }]).bind({
        plugin: { id: 'acme.plugin', version: '1.0.0' },
        contribution: { id: 'read', qualifiedId: 'acme.plugin/actions/read' },
        occurrenceId: '1', correlationId: 'read', surface: 'cli',
        signal: new AbortController().signal, isOccurrenceCurrent: () => true,
    });
    expect(settings).not.toBeNull();
    if (!settings) throw new Error('Declared Settings must bind');
    const reader = createPluginAccountActionSettingsService(settings).forScope({ kind: 'account' });
    await expect(reader.get('endpoint')).resolves.toBe('https://configured.example');
    expect(Object.keys(reader).sort()).toEqual(['describe', 'get', 'snapshot', 'watch']);
    expect(reads).toBe(1);
});

it('excludes Account declarations without a captured producer while retaining daemon declarations', () => {
    const createHost = createProductionPluginSettingsHostFactory({ accountScoped: true, broker: createStablePluginEventsBroker() });
    expect(createHost([{ pluginId: 'acme.plugin', contribution: declaration }]).hasPlugin('acme.plugin')).toBe(false);
    const host = createHost([{ pluginId: 'acme.plugin', contribution: declaration },
        { pluginId: 'acme.plugin', contribution: { ...declaration, id: 'machine', scope: 'daemon' } }]);
    expect(host.hasPlugin('acme.plugin')).toBe(true);
});
