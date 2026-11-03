import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedPersistedHomeProfilesForTests } from '@/dev/testkit/fixtures/persistedHomeProfiles';
import {
    homeProfileForTests,
    installTokenStorageTestIsolation,
    installTokenStorageWebPlatformMocks,
} from './tokenStorage.testHelpers';

const secureStoreState = vi.hoisted(() => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));

const asyncStorageState = vi.hoisted(() => {
    const values = new Map<string, string>();
    return {
        values,
        getItem: vi.fn(async (key: string) => values.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => {
            values.set(key, value);
        }),
        removeItem: vi.fn(async (key: string) => {
            values.delete(key);
        }),
    };
});

type DevGlobal = typeof globalThis & {
    __DEV__?: boolean;
};

const EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK = 'EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK';

function createIosSecureStoreEntitlementError(): Error {
    return new Error("Calling the 'setValueWithKeyAsync' function has failed\n→ Caused by: A required entitlement isn't present.");
}

installTokenStorageWebPlatformMocks({
    reactNative: async () => {
        const stub = await import('../../dev/reactNativeStub');
        const platform = {
            ...(stub.Platform ?? {}),
            OS: 'ios',
            select: (options: Record<string, unknown>) =>
                options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
        };
        return {
            ...stub,
            Platform: platform,
            AppState: {
                ...(stub.AppState ?? {}),
                currentState: 'active',
                addEventListener: () => ({ remove: () => {} }),
            },
        };
    },
    secureStore: async () => secureStoreState,
    asyncStorage: async () => ({
        default: asyncStorageState,
    }),
});
installTokenStorageTestIsolation('token_storage_native_secure_store_fallback');

const { TokenStorage } = await import('./tokenStorage');

/** A fresh TokenStorage module instance over the same device storage, as after an app reload. */
async function reloadTokenStorage() {
    vi.resetModules();
    return (await import('./tokenStorage')).TokenStorage;
}

describe('TokenStorage (native secure-store entitlement fallback)', () => {
    let originalDev: boolean | undefined;
    let originalFallbackEnv: string | undefined;
    const devGlobal = globalThis as DevGlobal;

    beforeEach(async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        secureStoreState.getItemAsync.mockReset();
        secureStoreState.setItemAsync.mockReset();
        secureStoreState.deleteItemAsync.mockReset();
        asyncStorageState.getItem.mockClear();
        asyncStorageState.setItem.mockClear();
        asyncStorageState.removeItem.mockClear();
        asyncStorageState.values.clear();
        secureStoreState.getItemAsync.mockRejectedValue(createIosSecureStoreEntitlementError());
        secureStoreState.setItemAsync.mockRejectedValue(createIosSecureStoreEntitlementError());
        secureStoreState.deleteItemAsync.mockRejectedValue(createIosSecureStoreEntitlementError());
        await seedPersistedHomeProfilesForTests({
            profiles: [homeProfileForTests('server-a', 'https://server-a.example.test')],
            activeServerId: 'server-a',
        });
        originalDev = devGlobal.__DEV__;
        originalFallbackEnv = process.env[EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK];
        delete process.env[EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK];
        devGlobal.__DEV__ = true;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        asyncStorageState.values.clear();
        if (originalDev === undefined) {
            delete devGlobal.__DEV__;
        } else {
            devGlobal.__DEV__ = originalDev;
        }
        if (originalFallbackEnv === undefined) {
            delete process.env[EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK];
        } else {
            process.env[EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK] = originalFallbackEnv;
        }
    });

    it.each([
        {
            name: 'credentials',
            write: async () => await TokenStorage.setCredentials({ token: 'token-dev', secret: 'secret-dev' }),
            read: async (reloaded: typeof TokenStorage) => await reloaded.getCredentials(),
            expected: { token: 'token-dev', secret: 'secret-dev' },
        },
        {
            name: 'auth auto redirect suppression',
            write: async () => await TokenStorage.setAuthAutoRedirectSuppressedUntil(123456),
            read: async (reloaded: typeof TokenStorage) => await reloaded.getAuthAutoRedirectSuppressedUntil(),
            expected: 123456,
        },
    ])('reads $name back after reload when secure store entitlements are unavailable in dev', async ({ write, read, expected }) => {
        await expect(write()).resolves.toBe(true);

        const reloaded = await reloadTokenStorage();
        await expect(read(reloaded)).resolves.toEqual(expected);
    });

    it('does not fall back to AsyncStorage outside dev mode', async () => {
        process.env[EXPO_PUBLIC_HAPPIER_NATIVE_SECURE_STORE_DEV_FALLBACK] = '0';
        devGlobal.__DEV__ = false;

        const { Platform } = await import('react-native');
        expect(Platform.OS).toBe('ios');

        await expect(TokenStorage.setCredentials({ token: 'token-prod', secret: 'secret-prod' })).resolves.toBe(false);

        const reloaded = await reloadTokenStorage();
        await expect(reloaded.getCredentials()).resolves.toBeNull();
    });

    it('clears same-URL credentials for every server profile during global logout', async () => {
        const sharedUrl = 'https://shared.example.test';
        // The profile owner folds identity-less profiles at one URL; distinct Homes there carry distinct identities.
        const profiles = [
            homeProfileForTests('server-a', sharedUrl, { serverIdentityId: 'srv_shared_a', canonicalServerUrl: sharedUrl }),
            homeProfileForTests('server-b', sharedUrl, { serverIdentityId: 'srv_shared_b', canonicalServerUrl: sharedUrl }),
        ];
        await seedPersistedHomeProfilesForTests({ profiles, activeServerId: 'server-a' });

        await expect(TokenStorage.setCredentials({ token: 'token-a', secret: 'secret-a' })).resolves.toBe(true);

        await seedPersistedHomeProfilesForTests({ profiles, activeServerId: 'server-b' });
        await expect(TokenStorage.setCredentials({ token: 'token-b', secret: 'secret-b' })).resolves.toBe(true);

        await seedPersistedHomeProfilesForTests({ profiles, activeServerId: 'server-a' });
        await expect(TokenStorage.getCredentialsForServerUrl(sharedUrl, { serverId: 'server-a' })).resolves.toEqual({ token: 'token-a', secret: 'secret-a' });
        await expect(TokenStorage.getCredentialsForServerUrl(sharedUrl, { serverId: 'server-b' })).resolves.toEqual({ token: 'token-b', secret: 'secret-b' });
        await expect(TokenStorage.removeCredentials()).resolves.toBe(true);

        await expect(TokenStorage.getCredentialsForServerUrl(sharedUrl, { serverId: 'server-a' })).resolves.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(sharedUrl, { serverId: 'server-b' })).resolves.toBeNull();
    });
});
