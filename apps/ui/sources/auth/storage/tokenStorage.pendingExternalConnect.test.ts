import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedPersistedHomeProfilesForTests } from '@/dev/testkit/fixtures/persistedHomeProfiles';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import {
    homeProfileForTests,
    installTokenStorageTestIsolation,
    installTokenStorageWebPlatformMocks,
} from './tokenStorage.testHelpers';
import { installLocalStorageMock, type LocalStorageMockHandle } from './tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();
installTokenStorageTestIsolation('token_storage_pending_external_connect');

const { TokenStorage } = await import('./tokenStorage');

const RELAY = homeProfileForTests('server-a', 'https://relay.example.test', { name: 'Server A' });
const SHARED_URL = 'https://shared.example.test';
// The profile owner folds identity-less profiles at one URL; distinct Homes there carry distinct identities.
const SHARED_A = homeProfileForTests('server-a', SHARED_URL, { name: 'Server A', serverIdentityId: 'srv_shared_a', canonicalServerUrl: SHARED_URL });
const SHARED_B = homeProfileForTests('server-b', SHARED_URL, { name: 'Server B', serverIdentityId: 'srv_shared_b', canonicalServerUrl: SHARED_URL });

async function focus(profiles: readonly ServerProfile[], activeServerId: string): Promise<void> {
    await seedPersistedHomeProfilesForTests({ profiles, activeServerId });
}

describe('TokenStorage pending external connect (web)', () => {
    let restoreLocalStorage: (() => void) | null = null;
    let localStorageHandle: LocalStorageMockHandle | null = null;

    function requireStorage(): LocalStorageMockHandle {
        if (!localStorageHandle) {
            throw new Error('Expected localStorage mock handle');
        }
        return localStorageHandle;
    }

    beforeEach(() => {
        localStorageHandle = installLocalStorageMock();
        restoreLocalStorage = localStorageHandle.restore;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreLocalStorage?.();
        restoreLocalStorage = null;
        localStorageHandle = null;
    });

    it('round-trips pending external connect state and falls back to the global record for the same active server', async () => {
        await focus([RELAY], RELAY.id);

        await expect(TokenStorage.getPendingExternalConnect()).resolves.toBeNull();
        await expect(
            TokenStorage.setPendingExternalConnect({ provider: 'github', returnTo: '/friends' }),
        ).resolves.toBe(true);
        await expect(TokenStorage.getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
            serverId: 'server-a',
            serverUrl: 'https://relay.example.test',
        });

        const storage = requireStorage();
        const pendingKeys = [...storage.store.keys()].filter((key) => key.includes('pending_external_connect'));
        expect(pendingKeys.length).toBe(2);
        expect(pendingKeys.some((key) => key.includes('__srv_'))).toBe(true);
        expect(pendingKeys.some((key) => key.includes('__global'))).toBe(true);

        for (const key of pendingKeys) {
            if (key.includes('__srv_')) {
                storage.store.delete(key);
            }
        }

        await expect(TokenStorage.getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
            serverId: 'server-a',
            serverUrl: 'https://relay.example.test',
        });

        await expect(TokenStorage.clearPendingExternalConnect()).resolves.toBe(true);
        await expect(TokenStorage.getPendingExternalConnect()).resolves.toBeNull();
    });

    it('keeps a pending connect bound to the exact Home that started it after focus moves', async () => {
        // A connect continuation belongs to the Home whose credential started it
        // (teams-lane-03/02 TA-R14/TA-R16). Focus moving to another Home — even one
        // sharing the same origin — must neither hide it nor retarget it.
        await focus([SHARED_A, SHARED_B], SHARED_A.id);

        await expect(
            TokenStorage.setPendingExternalConnect({
                provider: 'github',
                returnTo: '/friends',
                serverUrl: SHARED_URL,
                serverId: 'server-a',
            }),
        ).resolves.toBe(true);

        await focus([SHARED_A, SHARED_B], SHARED_B.id);

        await expect(TokenStorage.getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
            serverId: 'server-a',
            serverUrl: 'https://shared.example.test',
        });
    });

    it('records a Team connect started for a non-focused Home under that exact Home', async () => {
        await focus([
            homeProfileForTests('server-a', 'https://a.example.test', { name: 'Server A' }),
            homeProfileForTests('server-b', 'https://b.example.test', { name: 'Server B' }),
        ], 'server-a');

        await expect(TokenStorage.setPendingExternalConnect({
            provider: 'workos-team',
            returnTo: '/teams/team-1/sign-in',
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
        })).resolves.toBe(true);

        // The focused Home is still server-a; the read recovers the exact target from storage.
        await expect(TokenStorage.getPendingExternalConnect()).resolves.toEqual({
            provider: 'workos-team',
            returnTo: '/teams/team-1/sign-in',
            serverId: 'server-b',
            serverUrl: 'https://b.example.test',
        });
        const storage = requireStorage();
        const storedTargets = [...storage.store.entries()]
            .filter(([key]) => key.includes('pending_external_connect'))
            .map(([, value]) => JSON.parse(String(value)).serverId);
        expect(storedTargets.every((serverId) => serverId === 'server-b')).toBe(true);

        await expect(TokenStorage.clearPendingExternalConnect()).resolves.toBe(true);
        await expect(TokenStorage.getPendingExternalConnect()).resolves.toBeNull();
        expect([...storage.store.keys()].filter((key) => key.includes('pending_external_connect'))).toEqual([]);
    });

    it('clears the original scoped pending external connect key even after the active server changes', async () => {
        await focus([SHARED_A, SHARED_B], SHARED_A.id);

        await expect(
            TokenStorage.setPendingExternalConnect({
                provider: 'github',
                returnTo: '/friends',
                serverUrl: SHARED_URL,
                serverId: 'server-a',
            }),
        ).resolves.toBe(true);

        await focus([SHARED_A, SHARED_B], SHARED_B.id);

        await expect(TokenStorage.clearPendingExternalConnect()).resolves.toBe(true);

        const remainingScopedKeys = [...requireStorage().store.keys()].filter(
            (key) => key.includes('pending_external_connect') && key.includes('__srv_'),
        );
        expect(remainingScopedKeys).toEqual([]);
    });

    it('accepts scoped pending external connect records that omit explicit server context', async () => {
        await focus([RELAY], RELAY.id);

        await expect(
            TokenStorage.setPendingExternalConnect({ provider: 'github', returnTo: '/friends' }),
        ).resolves.toBe(true);

        const storage = requireStorage();
        for (const key of [...storage.store.keys()]) {
            if (key.includes('pending_external_connect') && key.includes('__srv_')) {
                storage.store.set(key, JSON.stringify({ provider: 'github', returnTo: '/friends' }));
            }
            if (key.includes('pending_external_connect') && key.includes('__global')) {
                storage.store.delete(key);
            }
        }

        await expect(TokenStorage.getPendingExternalConnect()).resolves.toEqual({
            provider: 'github',
            returnTo: '/friends',
        });
    });

    it.each([
        { name: 'a valid record', payload: { provider: 'github', returnTo: '/friends' }, expected: { provider: 'github', returnTo: '/friends' } },
        { name: 'a malformed record', payload: { provider: 'github', returnTo: 123 }, expected: null },
    ])('reads $name stored at the exact pending external connect key', async ({ payload, expected }) => {
        await focus([RELAY], RELAY.id);
        await expect(
            TokenStorage.setPendingExternalConnect({ provider: 'github', returnTo: '/friends' }),
        ).resolves.toBe(true);
        const storage = requireStorage();
        const pendingKeys = [...storage.store.keys()].filter((key) => key.includes('pending_external_connect'));
        const scopedKey = pendingKeys.find((key) => key.includes('__srv_'));
        if (!scopedKey) throw new Error('Expected the scoped pending external connect key');
        // Leave only the exact scoped record, so the read cannot fall back to the global copy.
        for (const key of pendingKeys) {
            if (key !== scopedKey) storage.store.delete(key);
        }
        storage.store.set(scopedKey, JSON.stringify(payload));

        await expect(TokenStorage.getPendingExternalConnect()).resolves.toEqual(expected);
    });
});
