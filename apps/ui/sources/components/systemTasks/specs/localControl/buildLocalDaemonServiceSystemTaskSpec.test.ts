import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLocalDaemonServiceSystemTaskSpec } from './buildLocalDaemonServiceSystemTaskSpec';

const activeServer = vi.hoisted(() => ({ serverUrl: '', serverIdentityId: null as string | null }));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        getActiveServerSnapshot: () => ({ serverId: 'active', serverUrl: activeServer.serverUrl, generation: 1 }),
        getServerProfileById: (id: string) => (id === 'active'
            ? { id, name: 'Active', serverUrl: activeServer.serverUrl, serverIdentityId: activeServer.serverIdentityId, createdAt: 0, updatedAt: 0, lastUsedAt: 0 }
            : null),
    };
});

describe('buildLocalDaemonServiceSystemTaskSpec', () => {
    beforeEach(() => {
        activeServer.serverUrl = '';
        activeServer.serverIdentityId = null;
    });

    // R10 D3: "this computer" is the daemon serving the app's own server, never whatever server
    // the terminal happens to follow. Only the Personal Home bootstrap names another Home.
    it('addresses every daemon kind to the app\'s active server unless the caller names a Home', () => {
        activeServer.serverUrl = 'https://company.example.test';
        activeServer.serverIdentityId = 'srv_company';
        const daemonKinds = [
            'daemon.service.status.v1',
            'daemon.service.start.v1',
            'daemon.service.stop.v1',
            'daemon.service.restart.v1',
            'cli.update.v1',
        ] as const;
        for (const kind of daemonKinds) {
            expect(buildLocalDaemonServiceSystemTaskSpec(kind).params)
                .toMatchObject({ relayUrl: 'https://company.example.test', serverIdentityId: 'srv_company' });
        }
        // The Personal Home bootstrap names its own Home, identity included.
        const named = buildLocalDaemonServiceSystemTaskSpec('daemon.service.status.v1', { relayUrl: 'http://127.0.0.1:43110', serverIdentityId: 'srv_personal' });
        expect(named.params).toMatchObject({ relayUrl: 'http://127.0.0.1:43110', serverIdentityId: 'srv_personal' });
        // A named Home without a known identity never borrows the active server's.
        expect(buildLocalDaemonServiceSystemTaskSpec('daemon.service.status.v1', { relayUrl: 'http://127.0.0.1:43110' }).params)
            .not.toHaveProperty('serverIdentityId');
        expect(buildLocalDaemonServiceSystemTaskSpec('cli.pathExposure.ensure.v1').params).not.toHaveProperty('relayUrl');
    });

    // R16 b: the one login-start setting covers every service the app manages here, so it names no Home.
    it('addresses the login-start setting to every managed service, carrying the mode', () => {
        activeServer.serverUrl = 'https://company.example.test';
        activeServer.serverIdentityId = 'srv_company';
        const params = buildLocalDaemonServiceSystemTaskSpec('daemon.service.autostart.set.v1', {}, { autostart: 'on-demand' }).params;
        expect(params).toMatchObject({ autostart: 'on-demand', channel: 'stable' });
        expect(params).not.toHaveProperty('relayUrl');
        expect(params).not.toHaveProperty('serverIdentityId');
    });

    it('addresses every managed service when asked, never borrowing the active Home', () => {
        activeServer.serverUrl = 'https://company.example.test';
        activeServer.serverIdentityId = 'srv_company';
        const params = buildLocalDaemonServiceSystemTaskSpec('daemon.service.stop.v1', { allManagedServices: true }).params;
        expect(params).not.toHaveProperty('relayUrl');
        expect(params).not.toHaveProperty('serverIdentityId');
    });

    it('uses channel=dev for publicdev builds', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({
            config: {
                variant: 'publicdev',
            },
        }));

        const { buildLocalDaemonServiceSystemTaskSpec } = await import('./buildLocalDaemonServiceSystemTaskSpec');
        const spec = buildLocalDaemonServiceSystemTaskSpec('daemon.service.status.v1');
        const params = spec.params as Record<string, unknown>;
        expect(params.channel).toBe('dev');
    });

    it.each(['daemon.service.start.v1', 'daemon.service.stop.v1', 'daemon.service.restart.v1'] as const)(
        'builds %s tasks for the local machine',
        (kind) => {
            expect(buildLocalDaemonServiceSystemTaskSpec(kind)).toEqual({
                protocolVersion: 1,
                kind,
                params: {
                    channel: 'stable',
                    target: { kind: 'local' },
                    surface: 'desktop.ui',
                    mode: 'user',
                },
            });
        },
    );

    it('builds the PATH exposure tasks on the same local params', () => {
        for (const kind of ['cli.pathExposure.ensure.v1', 'cli.pathExposure.remove.v1'] as const) {
            expect(buildLocalDaemonServiceSystemTaskSpec(kind)).toEqual({
                protocolVersion: 1,
                kind,
                params: {
                    channel: 'stable',
                    target: { kind: 'local' },
                    surface: 'desktop.ui',
                    mode: 'user',
                },
            });
        }
    });
});
