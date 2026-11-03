import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedPersistedHomeProfilesForTests } from '@/dev/testkit/fixtures/persistedHomeProfiles';
import { homeProfileForTests } from '@/auth/storage/tokenStorage.testHelpers';

import { buildRelayDriftRepairSystemTaskSpec } from './relayDriftSystemTask';

beforeEach(async () => {
    // The real Home profile owner reads the active Home from the device persistence boundary.
    const active = homeProfileForTests('active', 'https://relay.example.test', { serverIdentityId: 'srv_relay' });
    await seedPersistedHomeProfilesForTests({ profiles: [active], activeServerId: active.id });
});

describe('buildRelayDriftRepairSystemTaskSpec', () => {
    it('builds the stable repair task contract for aligning the background service to the active relay', () => {
        expect(buildRelayDriftRepairSystemTaskSpec({
            activeRelayUrl: 'https://relay.example.test/path',
            activeWebappUrl: 'https://app.example.test',
            activeLocalRelayUrl: 'http://127.0.0.1:3012',
        })).toEqual({
            protocolVersion: 1,
            kind: 'setup.repairThisComputer.v1',
            params: {
                channel: 'stable',
                activeRelayUrl: 'https://relay.example.test/path',
                activeWebappUrl: 'https://app.example.test',
                activeLocalRelayUrl: 'http://127.0.0.1:3012',
                // Same server as the active one by the protocol's comparable key.
                activeServerIdentityId: 'srv_relay',
                surface: 'desktop.ui',
            },
        });
    });

    // RV2-30: repairing the app's active server names that Home's identity, so a CLI holding two
    // profiles on one URL resolves the right one instead of failing as ambiguous.
    it('names the active server\'s Home identity when repairing it, and no identity for another URL', () => {
        expect(buildRelayDriftRepairSystemTaskSpec({
            activeRelayUrl: 'https://relay.example.test',
            activeWebappUrl: 'https://relay.example.test',
        }).params).toMatchObject({ activeServerIdentityId: 'srv_relay' });
        expect(buildRelayDriftRepairSystemTaskSpec({
            activeRelayUrl: 'https://other.example.test',
            activeWebappUrl: 'https://other.example.test',
        }).params).not.toHaveProperty('activeServerIdentityId');
    });

    it('uses channel=dev for publicdev builds', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({
            config: {
                variant: 'publicdev',
            },
        }));

        const { buildRelayDriftRepairSystemTaskSpec } = await import('./relayDriftSystemTask');

        const spec = buildRelayDriftRepairSystemTaskSpec({
            activeRelayUrl: 'https://relay.example.test/path',
            activeWebappUrl: 'https://app.example.test',
        });
        const params = spec.params as Record<string, unknown>;
        expect(params.channel).toBe('dev');
    });
});
