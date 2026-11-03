import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { installWebLockManagerMock } from '@/auth/storage/tokenStorage.web.testHelpers';

// The native secure-store boundary under the real device-local storage adapter (Platform.OS is not web here).
const secureStore = vi.hoisted(() => ({ values: new Map<string, string>(), readFailure: null as Error | null }));
vi.mock('expo-secure-store', () => ({
    getItemAsync: async (key: string) => {
        if (secureStore.readFailure) throw secureStore.readFailure;
        return secureStore.values.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => { secureStore.values.set(key, value); },
    deleteItemAsync: async (key: string) => { secureStore.values.delete(key); },
}));

const { accountDirectoryCredentialStorage } = await import('./accountDirectoryCredentialStorage');
const { TokenStorage } = await import('@/auth/storage/tokenStorage');
const storage = secureStore.values;

describe('account directory credential storage', () => {
    const webLocks = installWebLockManagerMock();

    afterEach(() => {
        storage.clear();
        secureStore.readFailure = null;
        delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
    });

    afterAll(() => {
        webLocks.restore();
    });

    it('serializes disjoint native Account Service writes through the process-local tail', async () => {
        const first = { endpoint: 'https://directory-a.test', serverIdentityId: 'directory-a' };
        const second = { endpoint: 'https://directory-b.test', serverIdentityId: 'directory-b' };

        await Promise.all([
            accountDirectoryCredentialStorage.set(first, { token: 'a' }),
            accountDirectoryCredentialStorage.set(second, { token: 'b' }),
        ]);

        await expect(accountDirectoryCredentialStorage.get(first)).resolves.toEqual({ token: 'a' });
        await expect(accountDirectoryCredentialStorage.get(second)).resolves.toEqual({ token: 'b' });
    });

    it('distinguishes absent, valid, corrupt, and unavailable custody', async () => {
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'srv_directory-1' };

        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({ kind: 'absent' });
        await accountDirectoryCredentialStorage.set(target, { token: 'directory-token' });
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({
            kind: 'valid',
            value: { token: 'directory-token' },
        });

        storage.set('account_directory_auth_credentials', '{"bad":true}');
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({ kind: 'corrupt' });

        secureStore.readFailure = new Error('secure storage unavailable');
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({ kind: 'unavailable' });
    });

    it('does not mutate credentials after corrupt or unavailable custody reads', async () => {
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'directory-1' };

        storage.set('account_directory_auth_credentials', '{"bad":true}');
        await expect(accountDirectoryCredentialStorage.set(target, { token: 'replacement' })).resolves.toBe(false);
        expect(storage.get('account_directory_auth_credentials')).toBe('{"bad":true}');

        secureStore.readFailure = new Error('secure storage unavailable');
        await expect(accountDirectoryCredentialStorage.remove(target)).resolves.toBe(false);
        expect(storage.get('account_directory_auth_credentials')).toBe('{"bad":true}');
    });

    it('preflights both custody records before logout mutates either key', async () => {
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'directory-1' };
        await accountDirectoryCredentialStorage.set(target, { token: 'directory-token' });
        storage.set('pending_account_directory_auth', '{"bad":true}');

        await expect(accountDirectoryCredentialStorage.logout(target)).resolves.toBe(false);
        await expect(accountDirectoryCredentialStorage.read(target)).resolves.toEqual({
            kind: 'valid',
            value: { token: 'directory-token' },
        });
        expect(storage.get('pending_account_directory_auth')).toBe('{"bad":true}');
    });

    it('scopes both Directory custody keys through the canonical storage-scope owner', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = 'profile-a';
        const target = { endpoint: 'https://directory.test', serverIdentityId: 'srv_directory-1' };
        const now = Date.now();

        await accountDirectoryCredentialStorage.set(target, { token: 'directory-token' });
        await TokenStorage.setPendingAccountDirectoryAuth({
            ...target,
            credentialTarget: 'account_directory',
            entryIntent: { kind: 'enter', target: { kind: 'automatic' } },
            canonicalServerUrl: target.endpoint,
            provider: 'github',
            purpose: 'account_directory',
            pending: 'pending-1',
            createdAt: now,
            expiresAt: now + 60_000,
        });

        expect(storage.has('account_directory_auth_credentials__profile-a')).toBe(true);
        expect(storage.has('pending_account_directory_auth__profile-a')).toBe(true);
        expect(storage.has('account_directory_auth_credentials')).toBe(false);
        expect(storage.has('pending_account_directory_auth')).toBe(false);
    });
});
