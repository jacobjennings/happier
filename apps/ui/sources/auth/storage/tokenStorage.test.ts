import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { seedPersistedHomeProfilesForTests } from '@/dev/testkit/fixtures/persistedHomeProfiles';
import { installLocalStorageMock, type LocalStorageMockHandle } from './tokenStorage.web.testHelpers';
import {
    homeProfileForTests,
    installTokenStorageTestIsolation,
    installTokenStorageWebPlatformMocks,
} from './tokenStorage.testHelpers';

installTokenStorageWebPlatformMocks();
installTokenStorageTestIsolation('token_storage_web');

const { TokenStorage } = await import('./tokenStorage');
const { readStorageScopeFromEnv, scopedStorageId } = await import('@/utils/system/storageScope');

describe('TokenStorage (web)', () => {
    let restoreLocalStorage: (() => void) | null = null;
    let localStorageHandle: LocalStorageMockHandle | null = null;

    function installStorage() {
        localStorageHandle = installLocalStorageMock();
        restoreLocalStorage = localStorageHandle.restore;
        return localStorageHandle;
    }

    async function focusLocalHome(): Promise<string> {
        await seedPersistedHomeProfilesForTests({
            profiles: [homeProfileForTests('localhost-3009', 'http://localhost:3009')],
            activeServerId: 'localhost-3009',
        });
        return scopedStorageId('auth_credentials__srv_localhost-3009', readStorageScopeFromEnv());
    }

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreLocalStorage?.();
        restoreLocalStorage = null;
        localStorageHandle = null;
    });

    it('returns null when the focused Home credential bytes are invalid JSON', async () => {
        const storage = installStorage();
        storage.setItemMock(await focusLocalHome(), '{not valid json');

        await expect(TokenStorage.getCredentials()).resolves.toBeNull();
    });

    it('returns a genuine token-only credential without manufacturing encryption material', async () => {
        const storage = installStorage();
        storage.setItemMock(await focusLocalHome(), JSON.stringify({ token: 't' }));

        await expect(TokenStorage.getCredentials()).resolves.toEqual({ token: 't' });
    });

    it('persists token-only credentials without recovery or Account encryption material', async () => {
        const storage = installStorage();
        const primaryKey = await focusLocalHome();

        await expect(TokenStorage.setCredentials({ token: 'token-only' })).resolves.toBe(true);

        expect(storage.store.get(primaryKey)).toBe(
            JSON.stringify({ token: 'token-only' }),
        );
        await expect(TokenStorage.getCredentials()).resolves.toEqual({ token: 'token-only' });
    });

    it('checks both primary and legacy scoped keys when credentials are missing', async () => {
        const storage = installStorage();
        storage.setItemMock('auth_credentials', JSON.stringify({ token: 't', secret: 's' }));

        await expect(TokenStorage.getCredentials()).resolves.toBeNull();
        const scopedKeys = storage.getItemMock.mock.calls.map(([key]) => String(key));
        expect(scopedKeys.every((key) => key.includes('auth_credentials__srv_'))).toBe(true);
        // A missing primary is re-read under mutation authority before migrating.
        expect(new Set(scopedKeys).size).toBeGreaterThanOrEqual(2);
    });

    it('fails closed without logging when localStorage is unavailable', async () => {
        restoreLocalStorage?.();
        restoreLocalStorage = null;
        localStorageHandle = null;

        Reflect.deleteProperty(globalThis, 'localStorage');

        await expect(TokenStorage.getCredentials()).resolves.toBeNull();
        expect(console.error).not.toHaveBeenCalled();
    });
});
