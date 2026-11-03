import fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';

import { createCliActionExecutorFromCredentials } from '@/session/actions/createCliActionExecutorFromCredentials';
import { registerAccountHomeHttp } from '@/session/actions/widgetApproval.testkit';
import { installAxiosFastifyAdapter } from '@/testkit/http/axiosAdapter';
import { registerAuthoredAccountActionRelease } from './accountPluginActions.testkit';

afterEach(() => vi.restoreAllMocks());

it.each([
    { surface: 'cli', retirement: 'none' }, { surface: 'agent', retirement: 'none' },
    { surface: 'mcp', retirement: 'none' }, { surface: 'ui', retirement: 'none' },
    { surface: 'voice', retirement: 'none' }, { surface: 'agent', retirement: 'workflow' },
    { surface: 'cli', retirement: 'rotate' }, { surface: 'cli', retirement: 'revoke' },
] as const)(
    'reads declared Account Settings through a public authored Action: $surface / $retirement', async ({ surface, retirement }) => {
        const app = fastify();
        const endpoint = 'http://account-settings.test';
        const accountId = `settings-owner-${surface}`;
        const credentials = { token: `header.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64url')}.signature`,
            encryption: null, credentialProvenance: 'stored_session' as const };
        let currentCredentials: typeof credentials | null = credentials;
        const { pluginId } = await registerAuthoredAccountActionRelease(app, accountId);
        const features = registerAccountHomeHttp(app, { accountId, serverId: 'srv_settings' });
        let recordReads = 0;
        let writes = 0;
        app.get(`/v1/account/plugin-settings/${pluginId}`, async request => {
            expect(request.headers.authorization).toBe(`Bearer ${credentials.token}`);
            recordReads++;
            if (retirement === 'rotate') currentCredentials = { ...credentials, token: `${credentials.token}-rotated` };
            if (retirement === 'revoke') currentCredentials = null;
            return { status: 'present', revision: 7,
                content: { t: 'plain', v: { v: 1, values: { endpoint: 'https://configured.example' } } } };
        });
        app.addHook('onRequest', async request => { if (request.method === 'POST'
            && request.url.startsWith('/v1/account/plugin-settings/')) writes++; });
        await app.ready();
        const restore = installAxiosFastifyAdapter({ app, origin: endpoint });
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(features));
        const executor = createCliActionExecutorFromCredentials({ credentials, serverId: 'settings',
            serverIdentityId: 'srv_settings', serverApiUrl: endpoint, readCredentials: async () => currentCredentials });
        try {
            const result = await executor.execute('action.invoke', {
                action: { pluginId, localId: 'read-settings' }, input: { key: 'endpoint' },
            }, { surface, runtimeAccountId: accountId, serverId: 'settings', serverIdentityId: 'srv_settings',
                ...(retirement === 'workflow' ? { executionRunWorkflowRunId: 'settings-run',
                    actionCaller: { kind: 'workflowRun' as const, runId: 'settings-run', authorization: {
                        principal: { kind: 'host' as const }, admittedPermissionCeiling: 'read-only' as const,
                    } } } : {}),
            });
            expect(result, result.ok ? 'ok' : result.errorCode).toMatchObject(retirement === 'rotate' || retirement === 'revoke'
                ? { ok: false, errorCode: 'plugin_settings_persistence_unavailable' }
                : { ok: true, result: {
                value: 'https://configured.example', readerMethods: ['describe', 'get', 'snapshot', 'watch'],
            } });
            expect(recordReads).toBe(1);
            expect(writes).toBe(0);
        } finally { restore(); await app.close(); }
    },
);

it('lists the real Channels PR Watch through the finite Account Action host', async () => {
    const app = fastify();
    const endpoint = 'http://channels-settings.test';
    const accountId = 'channels-settings-owner';
    const credentials = { token: `header.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64url')}.signature`,
        encryption: null, credentialProvenance: 'stored_session' as const };
    await registerAuthoredAccountActionRelease(app, accountId, { includeBundledPluginIds: ['happier.channels'] });
    const features = registerAccountHomeHttp(app, { accountId, serverId: 'srv_channels_settings' });
    let recordReads = 0;
    app.get('/v1/account/plugin-settings/happier.channels', async () => {
        recordReads++;
        return { status: 'absent' };
    });
    app.post('/v1/plugins/data/query', async () => ({ rows: [], changeCursor: 0 }));
    await app.ready();
    const restore = installAxiosFastifyAdapter({ app, origin: endpoint });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(features));
    const executor = createCliActionExecutorFromCredentials({ credentials, serverId: 'channels-settings',
        serverIdentityId: 'srv_channels_settings', serverApiUrl: endpoint, readCredentials: async () => credentials });
    try {
        const result = await executor.execute('action.invoke', {
            action: { pluginId: 'happier.channels', localId: 'session-pull-request-watch-v1' }, input: { kind: 'list' },
        }, { surface: 'cli', runtimeAccountId: accountId, serverId: 'channels-settings', serverIdentityId: 'srv_channels_settings' });
        expect(result, result.ok ? 'ok' : result.errorCode).toMatchObject({ ok: true, result: { sessions: [] } });
        expect(recordReads).toBe(1);
    } finally { restore(); await app.close(); }
});
