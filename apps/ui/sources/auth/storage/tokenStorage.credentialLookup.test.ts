import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedPersistedHomeProfilesForTests } from '@/dev/testkit/fixtures/persistedHomeProfiles';
import {
    homeProfileForTests,
    installTokenStorageTestIsolation,
    installTokenStorageWebPlatformMocks,
} from './tokenStorage.testHelpers';

/**
 * Cold boot blocks on the credential read, and on native every scope probe is a keychain round trip.
 * These tests pin the two things that matter there: the legacy scopes are probed together rather
 * than one round trip at a time, and the primary scope alone still answers the common case.
 */
const secureStoreState = vi.hoisted(() => {
    const values = new Map<string, string>();
    const readOrder: string[] = [];
    const readWithLatency = async (key: string) => {
        readOrder.push(key);
        state.inFlightReads += 1;
        state.maxConcurrentReads = Math.max(state.maxConcurrentReads, state.inFlightReads);
        try {
            await new Promise((resolve) => setTimeout(resolve, state.readLatencyMs));
            return values.get(key) ?? null;
        } finally {
            state.inFlightReads -= 1;
        }
    };
    const state = {
        values,
        readOrder,
        inFlightReads: 0,
        maxConcurrentReads: 0,
        readLatencyMs: 5,
        readWithLatency,
        getItemAsync: vi.fn(readWithLatency),
        setItemAsync: vi.fn(async (key: string, value: string) => {
            values.set(key, value);
        }),
        deleteItemAsync: vi.fn(async (key: string) => {
            values.delete(key);
        }),
    };
    return state;
});

installTokenStorageWebPlatformMocks({
    reactNative: async () => {
        const stub = await import('../../dev/reactNativeStub');
        return {
            ...stub,
            Platform: {
                ...(stub.Platform ?? {}),
                OS: 'ios',
                select: (options: Record<string, unknown>) =>
                    options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
            },
        };
    },
    secureStore: async () => secureStoreState,
});
installTokenStorageTestIsolation('token_storage_credential_lookup');

const { TokenStorage, setHomeCredentialsWithRollbackUnderMutationAuthority } = await import('./tokenStorage');
const { withHomeMutationAuthority } = await import('@/sync/domains/server/homeMutationLock');

const SERVER_URL = 'https://api.example.test';

/**
 * One focused Home whose stable identity retains two older profile ids as legacy credential scopes.
 * Identities use the canonical `srv_` form; the profile owner drops any other serverIdentityId.
 */
async function seedHomeWithLegacyScopes(): Promise<void> {
    const home = homeProfileForTests('srv-legacy-a', SERVER_URL, {
        serverIdentityId: 'srv_identity',
        legacyServerIds: ['srv-legacy-b'],
    });
    await seedPersistedHomeProfilesForTests({ profiles: [home], activeServerId: home.id });
}

/**
 * Two Homes can reach the same routing URL at once: one currently canonical there,
 * and one that moved its canonical URL while retaining the old alias. The anonymous
 * URL-hash credential stored under that URL belongs to neither identity in particular.
 */
async function seedHomesSharingUrl(): Promise<void> {
    const current = homeProfileForTests('srv-legacy-a', SERVER_URL, {
        serverIdentityId: 'srv_identity',
        canonicalServerUrl: SERVER_URL,
        legacyServerIds: ['srv-legacy-b'],
    });
    const moved = homeProfileForTests('srv-moved', SERVER_URL, {
        serverIdentityId: 'srv_moved_identity',
        canonicalServerUrl: 'https://moved.example.test',
    });
    await seedPersistedHomeProfilesForTests({ profiles: [current, moved], activeServerId: current.id });
}

/**
 * Discovers a target's scope layout from a cold miss (a miss is never cached), so a test can
 * seed keychain bytes the way a previous app run left them, with nothing in this module's read cache.
 */
async function readScopeLayout(read: () => Promise<unknown>): Promise<Readonly<{ primaryKey: string; legacyKeys: string[] }>> {
    await expect(read()).resolves.toBeNull();
    const [primaryKey, ...legacyKeys] = [...secureStoreState.readOrder];
    expect(primaryKey).toBeDefined();
    secureStoreState.readOrder.length = 0;
    secureStoreState.maxConcurrentReads = 0;
    secureStoreState.getItemAsync.mockClear();
    return { primaryKey: primaryKey!, legacyKeys };
}

describe('TokenStorage credential lookup (native keychain)', () => {
    beforeEach(() => {
        secureStoreState.values.clear();
        secureStoreState.readOrder.length = 0;
        secureStoreState.inFlightReads = 0;
        secureStoreState.maxConcurrentReads = 0;
        secureStoreState.readLatencyMs = 5;
        secureStoreState.getItemAsync.mockReset().mockImplementation(secureStoreState.readWithLatency);
        secureStoreState.setItemAsync.mockClear();
        secureStoreState.deleteItemAsync.mockClear();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each([
        ['the focused Home', () => TokenStorage.getCredentials()],
        ['an explicitly requested server URL', () => TokenStorage.getCredentialsForServerUrl(SERVER_URL, { serverId: 'srv_identity' })],
    ] as const)('probes every legacy scope of %s concurrently instead of one keychain round trip at a time', async (_target, read) => {
        await seedHomeWithLegacyScopes();

        // Nothing is stored anywhere: the lookup has to probe the primary scope and then every
        // legacy scope, which is the worst case that used to serialise on the boot gate.
        await expect(read()).resolves.toBeNull();

        const legacyReadCount = secureStoreState.getItemAsync.mock.calls.length - 1;
        expect(legacyReadCount).toBeGreaterThan(1);
        expect(secureStoreState.maxConcurrentReads).toBe(legacyReadCount);
    });

    it('does not probe legacy scopes at all when the primary scope answers', async () => {
        await seedHomeWithLegacyScopes();
        const { primaryKey, legacyKeys } = await readScopeLayout(() => TokenStorage.getCredentials());
        expect(primaryKey).toContain('auth_credentials');
        expect(legacyKeys.length).toBeGreaterThan(1);
        secureStoreState.values.set(primaryKey, JSON.stringify({ token: 'token-1', secret: 'secret-1' }));

        await expect(TokenStorage.getCredentials()).resolves.toEqual({ token: 'token-1', secret: 'secret-1' });
        expect(secureStoreState.readOrder).toEqual([primaryKey]);
    });

    it('shares concurrent identical cold scoped reads at the Home authority', async () => {
        await seedHomeWithLegacyScopes();
        const options = { serverId: 'srv_identity', storageReadFailure: 'surface' as const };
        const { primaryKey } = await readScopeLayout(() => TokenStorage.getCredentialsForServerUrl(SERVER_URL, options));
        secureStoreState.values.set(primaryKey, JSON.stringify({ token: 'before' }));
        // Web Locks are the cross-tab Home mutation authority. Its queue is
        // also used when this native-host fixture has a browser coordinator.
        let tail: Promise<unknown> = Promise.resolve();
        const request = vi.fn((_name: string, run: () => Promise<unknown>) => {
            const result = tail.then(run);
            tail = result.catch(() => undefined);
            return result;
        });
        vi.stubGlobal('navigator', { locks: { request } });
        const reads = Array.from({ length: 12 }, () => TokenStorage.getCredentialsForServerUrl(SERVER_URL, options));
        expect(await Promise.all(reads)).toEqual(Array(12).fill({ token: 'before' }));
        expect(secureStoreState.readOrder).toHaveLength(1);
        expect(request).toHaveBeenCalledTimes(1);
        // Settlement releases the share; the native owner's existing raw cache
        // is independent of this one-operation queue sharing.
        expect(await TokenStorage.getCredentialsForServerUrl(SERVER_URL, options)).toEqual({ token: 'before' });
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('does not let a post-mutation read join an older scoped read still in flight', async () => {
        await seedHomeWithLegacyScopes();
        const options = { serverId: 'srv_identity', storageReadFailure: 'surface' as const };
        const { primaryKey } = await readScopeLayout(() => TokenStorage.getCredentialsForServerUrl(SERVER_URL, options));
        secureStoreState.values.set(primaryKey, JSON.stringify({ token: 'before' }));
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let started = false;
        secureStoreState.getItemAsync.mockImplementationOnce(async (key: string) => {
            const captured = secureStoreState.values.get(key) ?? null;
            started = true;
            await gate;
            return captured;
        });
        const before = TokenStorage.getCredentialsForServerUrl(SERVER_URL, options);
        await vi.waitFor(() => expect(started).toBe(true));
        const mutation = TokenStorage.setCredentialsForServerUrl(SERVER_URL, options, { token: 'after' });
        const after = TokenStorage.getCredentialsForServerUrl(SERVER_URL, options);
        release();
        expect(await before).toEqual({ token: 'before' });
        expect(await mutation).toBe(true);
        expect(await after).toEqual({ token: 'after' });
    });

    it('interrupts sharing when a profile-adoption writer already holds its Home authority', async () => {
        await seedHomeWithLegacyScopes();
        const options = { serverId: 'srv_identity', storageReadFailure: 'surface' as const };
        const { primaryKey } = await readScopeLayout(() => TokenStorage.getCredentialsForServerUrl(SERVER_URL, options));
        secureStoreState.values.set(primaryKey, JSON.stringify({ token: 'before' }));
        // Native adoption has a composed authority but no browser Web Lock.
        // Node's optional Web Locks must not turn this case into a lock deadlock.
        vi.stubGlobal('navigator', {});
        await withHomeMutationAuthority(undefined, async (authority) => {
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            let started = false;
            secureStoreState.getItemAsync.mockImplementationOnce(async (key: string) => {
                const captured = secureStoreState.values.get(key) ?? null;
                started = true;
                await gate;
                return captured;
            });
            const before = TokenStorage.getCredentialsForServerUrl(SERVER_URL, options);
            await vi.waitFor(() => expect(started).toBe(true));
            const mutation = setHomeCredentialsWithRollbackUnderMutationAuthority(authority, SERVER_URL, options, { token: 'after' });
            const after = TokenStorage.getCredentialsForServerUrl(SERVER_URL, options);
            release();
            expect(await before).toEqual({ token: 'before' });
            expect(await mutation).not.toBeNull();
            expect(await after).toEqual({ token: 'after' });
        });
    });

    it('keeps legacy scope precedence and still migrates the winner onto the primary scope', async () => {
        await seedHomeWithLegacyScopes();
        const { primaryKey, legacyKeys } = await readScopeLayout(() => TokenStorage.getCredentials());
        expect(legacyKeys.length).toBeGreaterThan(1);

        secureStoreState.values.set(legacyKeys[0]!, JSON.stringify({ token: 'legacy-first', secret: 's1' }));
        secureStoreState.values.set(legacyKeys[1]!, JSON.stringify({ token: 'legacy-second', secret: 's2' }));

        await expect(TokenStorage.getCredentials()).resolves.toEqual({ token: 'legacy-first', secret: 's1' });
        expect(secureStoreState.values.get(primaryKey)).toBe(JSON.stringify({ token: 'legacy-first', secret: 's1' }));
        expect(secureStoreState.values.has(legacyKeys[0]!)).toBe(false);
        // Losing legacy scopes are left alone; only the migrated one is retired.
        expect(secureStoreState.values.has(legacyKeys[1]!)).toBe(true);
    });

    it('does not overwrite or misattribute a primary credential written during legacy migration', async () => {
        await seedHomeWithLegacyScopes();
        const { primaryKey, legacyKeys: [legacyKey] } = await readScopeLayout(() => TokenStorage.getCredentials());
        expect(legacyKey).toBeDefined();
        const legacyRaw = JSON.stringify({ token: 'legacy-token', secret: 'legacy-secret' });
        const concurrentRaw = JSON.stringify({ token: 'concurrent-token', secret: 'concurrent-secret' });
        secureStoreState.values.set(legacyKey!, legacyRaw);

        let primaryReads = 0;
        secureStoreState.getItemAsync.mockImplementation(async (key: string) => {
            if (key === primaryKey && ++primaryReads === 2) {
                secureStoreState.values.set(primaryKey, concurrentRaw);
            }
            return secureStoreState.values.get(key) ?? null;
        });

        await expect(TokenStorage.getCredentials()).resolves.toEqual({
            token: 'concurrent-token',
            secret: 'concurrent-secret',
        });
        expect(secureStoreState.values.get(primaryKey)).toBe(concurrentRaw);
        expect(secureStoreState.values.get(legacyKey!)).toBe(legacyRaw);
        expect(secureStoreState.setItemAsync).not.toHaveBeenCalledWith(primaryKey, legacyRaw);
    });

    it('never promotes an anonymous URL-hash credential into an identity that shares that URL with another Home', async () => {
        // With no Home profile at the URL, an explicit URL-only target resolves to the anonymous URL-hash scope.
        const { primaryKey: urlHashKey } = await readScopeLayout(() => TokenStorage.getCredentialsForServerUrl(SERVER_URL, {}));
        secureStoreState.values.set(urlHashKey, JSON.stringify({ token: 'anonymous-url', secret: 'anon' }));

        await seedHomesSharingUrl();
        secureStoreState.readOrder.length = 0;

        // Ownership of the anonymous scope is ambiguous, so it is neither read as
        // this identity's credential nor migrated into (and deleted from) it.
        await expect(
            TokenStorage.getCredentialsForServerUrl(SERVER_URL, { serverId: 'srv_identity' }),
        ).resolves.toBeNull();
        expect(secureStoreState.readOrder).not.toContain(urlHashKey);
        expect(secureStoreState.values.get(urlHashKey)).toBe(
            JSON.stringify({ token: 'anonymous-url', secret: 'anon' }),
        );
        expect([...secureStoreState.values.keys()]).toEqual([urlHashKey]);

        // Positive control: without the shared-URL ambiguity the same bytes are a readable credential.
        await seedPersistedHomeProfilesForTests({ profiles: [], activeServerId: '' });
        await expect(TokenStorage.getCredentialsForServerUrl(SERVER_URL, {})).resolves.toEqual({ token: 'anonymous-url', secret: 'anon' });
    });
});
