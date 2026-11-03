import { describe, expect, it, vi } from 'vitest';

import { buildLocalMachineSetupSystemTaskSpec } from './buildLocalMachineSetupSystemTaskSpec';

const activeServer = vi.hoisted(() => ({ serverUrl: 'https://relay.example.test', serverIdentityId: 'srv_relay' as string | null }));

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

describe('buildLocalMachineSetupSystemTaskSpec', () => {
    // RV2-30: setting up the app's active server names that Home's identity; a caller-named Home
    // (the Personal Home bootstrap) keeps its own.
    it('names the active server\'s Home identity unless the caller names one', () => {
        expect(buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: 'https://relay.example.test',
            activeWebappUrl: 'https://relay.example.test',
        }).params).toMatchObject({ activeServerIdentityId: 'srv_relay' });
        expect(buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: 'http://127.0.0.1:43110',
            activeWebappUrl: 'http://127.0.0.1:43110',
            activeServerIdentityId: 'srv_personal',
        }).params).toMatchObject({ activeServerIdentityId: 'srv_personal' });
        expect(buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: 'http://127.0.0.1:43110',
            activeWebappUrl: 'http://127.0.0.1:43110',
        }).params).not.toHaveProperty('activeServerIdentityId');
    });

    it('uses channel=dev for publicdev builds (systemTasks channels are labels, not ring ids)', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({
            config: {
                variant: 'publicdev',
            },
        }));

        const { buildLocalMachineSetupSystemTaskSpec } = await import('./buildLocalMachineSetupSystemTaskSpec');

        const spec = buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: 'https://relay.example.test',
            activeWebappUrl: 'https://app.example.test',
        });
        const params = spec.params as Record<string, unknown>;
        expect(params.channel).toBe('dev');
    });

    it('includes the explicit UI-selected relay profile when provided', async () => {
        vi.resetModules();
        const { buildLocalMachineSetupSystemTaskSpec } = await import('./buildLocalMachineSetupSystemTaskSpec');

        const spec = buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: 'https://relay.example.test',
            activeWebappUrl: 'https://app.example.test',
            activeLocalRelayUrl: 'http://127.0.0.1:53288',
            installService: true,
        });
        const params = spec.params as Record<string, unknown>;

        expect(params).toMatchObject({
            activeRelayUrl: 'https://relay.example.test',
            activeWebappUrl: 'https://app.example.test',
            activeLocalRelayUrl: 'http://127.0.0.1:53288',
            installService: true,
        });
    });

    // The relay pair is the one thing a UI caller must never leave to the CLI's own selection:
    // the executor's ambient fallback exists for terminal-initiated `hsetup`, not for the app.
    it('requires an explicit relay pair from every UI caller', async () => {
        vi.resetModules();
        const { buildLocalMachineSetupSystemTaskSpec } = await import('./buildLocalMachineSetupSystemTaskSpec');

        // @ts-expect-error omitting the relay pair must not compile
        void (() => buildLocalMachineSetupSystemTaskSpec());

        const params = buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: '  https://relay.example.test  ',
            activeWebappUrl: '  https://app.example.test  ',
        }).params as Record<string, unknown>;
        expect(params.activeRelayUrl).toBe('https://relay.example.test');
        expect(params.activeWebappUrl).toBe('https://app.example.test');
    });
});
