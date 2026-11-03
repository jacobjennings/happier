import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IrohError } from '@happier-dev/iroh-native';

const acquireBrowserSpy = vi.hoisted(() => vi.fn());
const acquireNativeSpy = vi.hoisted(() => vi.fn());

// Only the carrier acquisition (worker/wasm) is a boundary here; the real
// eligibility decision and the real host decision run beneath it.
vi.mock('@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier')>()),
    acquireBrowserIrohHomeCarrier: (input: unknown) => acquireBrowserSpy(input),
}));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeWebMock();
});

import {
    acquireEligibleHomeCarrier,
    drainRetainedHomeCarrierReleases,
} from './homeCarrierPolicy';
import { createIrohHomeTunnelSupervisor } from './nativeIrohTunnels/supervisor';
import { getStorage } from '@/sync/domains/state/storageStore';
import type { IrohHomeTunnelAcquireInput } from './nativeIrohTunnels/types';

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';
const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
    + ' Chrome/150.0.0.0 Safari/537.36';

/** Describes the host through the same boundary globals the real host decision reads. */
function setHost(kind: 'browser' | 'desktop' | 'no_shared_worker'): void {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: BROWSER_USER_AGENT } });
    if (kind === 'no_shared_worker') {
        Reflect.deleteProperty(globalThis, 'SharedWorker');
    } else {
        Object.defineProperty(globalThis, 'SharedWorker', { configurable: true, value: function SharedWorkerStub() {} });
    }
    if (kind === 'desktop') {
        (globalThis as Record<string, unknown>)[TAURI_INTERNALS_KEY] = { invoke: () => null };
    } else {
        Reflect.deleteProperty(globalThis, TAURI_INTERNALS_KEY);
    }
}

const endpoint = { endpointId: 'a'.repeat(64), relayUrls: ['https://relay.example.test/'] };
const baseInput = {
    acquireNative: (input: IrohHomeTunnelAcquireInput) => acquireNativeSpy(input),
    mode: 'initial_selection' as const,
    applicationCarrierEligibility: 'automatic' as const,
    descriptor: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_a',
        canonicalServerUrl: 'https://canonical.example.test',
        revision: 7,
        endpoints: [
            { kind: 'iroh' as const, ...endpoint },
            { kind: 'https' as const, url: 'https://public.example.test' },
        ],
    },
    verification: { kind: 'authenticated' as const, token: 'home-token' },
};

describe('acquireEligibleHomeCarrier', () => {
    beforeEach(() => {
        acquireBrowserSpy.mockReset();
        acquireNativeSpy.mockReset();
        setHost('browser');
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, TAURI_INTERNALS_KEY);
        Reflect.deleteProperty(globalThis, 'navigator');
        Reflect.deleteProperty(globalThis, 'SharedWorker');
    });

    it('uses device-local Standard only even when a caller requests automatic selection', async () => {
        const store = getStorage();
        const previous = store.getState().localSettings;
        store.setState({ localSettings: { ...previous, homeApplicationCarrierEligibility: 'standard_only' } });
        try {
            const acquired = await acquireEligibleHomeCarrier(baseInput);
            expect(acquired).toEqual({ kind: 'https', runtimeOrigin: 'https://public.example.test' });
            expect(acquireBrowserSpy).not.toHaveBeenCalled();
            expect(acquireNativeSpy).not.toHaveBeenCalled();
        } finally {
            store.setState({ localSettings: previous });
        }
    });

    it('returns only the acquired browser carrier when the browser carrier is eligible', async () => {
        const release = vi.fn(async () => {});
        const carrier = {
            leaseId: 'browser-lease',
            homeServerIdentityId: baseInput.descriptor.homeServerIdentityId,
            endpointId: endpoint.endpointId,
            release,
        };
        acquireBrowserSpy.mockResolvedValue(carrier);

        const acquired = await acquireEligibleHomeCarrier(baseInput);
        expect(acquired).toEqual({
            kind: 'browser_iroh',
            carrier: { ...carrier, release: expect.any(Function) },
            release: expect.any(Function),
        });
        if (acquired.kind !== 'browser_iroh') return;
        expect(acquired.carrier.release).toBe(acquired.release);
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('returns only the acquired native runtime origin when the browser host is ineligible', async () => {
        const release = vi.fn(async () => {});
        const lease = {
            leaseId: 'native-lease',
            homeServerIdentityId: baseInput.descriptor.homeServerIdentityId,
            endpointId: endpoint.endpointId,
            runtimeOrigin: 'http://127.0.0.1:43123',
            status: 'ready',
            release,
        };
        setHost('desktop');
        acquireNativeSpy.mockResolvedValue(lease);

        const acquired = await acquireEligibleHomeCarrier(baseInput);
        expect(acquired).toEqual({
            kind: 'native_iroh',
            lease: { ...lease, release: expect.any(Function) },
            release: expect.any(Function),
        });
        if (acquired.kind !== 'native_iroh') return;
        expect(acquired.lease.release).toBe(acquired.release);
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
    });

    it('retries a failed native lease release on the next explicit release, then stays released', async () => {
        const release = vi.fn()
            .mockRejectedValueOnce(new Error('native release failed'))
            .mockResolvedValueOnce(undefined);
        setHost('desktop');
        acquireNativeSpy.mockResolvedValue({
            leaseId: 'native-release-retry',
            homeServerIdentityId: baseInput.descriptor.homeServerIdentityId,
            endpointId: endpoint.endpointId,
            runtimeOrigin: 'http://127.0.0.1:43123',
            status: 'ready',
            release,
        });

        const acquired = await acquireEligibleHomeCarrier(baseInput);
        expect(acquired.kind).toBe('native_iroh');
        if (acquired.kind !== 'native_iroh') return;
        await expect(acquired.release()).rejects.toThrow('native release failed');
        await expect(acquired.release()).resolves.toBeUndefined();
        await expect(acquired.release()).resolves.toBeUndefined();
        expect(release).toHaveBeenCalledTimes(2);
    });

    it('fails closed and releases a browser carrier whose returned endpoint differs from the requested endpoint', async () => {
        const release = vi.fn(async () => {});
        acquireBrowserSpy.mockResolvedValue({ leaseId: 'wrong-browser', endpointId: 'b'.repeat(64), release });

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toMatchObject({
            kind: 'fail_closed',
            fallbackAllowed: false,
        });
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('fails closed and releases a native carrier that is not verified ready', async () => {
        const release = vi.fn(async () => {});
        setHost('desktop');
        acquireNativeSpy.mockResolvedValue({
            leaseId: 'not-ready-native',
            endpointId: endpoint.endpointId,
            runtimeOrigin: 'http://127.0.0.1:43123',
            status: 'degraded',
            release,
        });

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toMatchObject({
            kind: 'fail_closed',
            fallbackAllowed: false,
        });
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('returns independently trusted HTTPS only for an allowed Iroh fallback', async () => {
        setHost('desktop');
        acquireNativeSpy.mockRejectedValue(new IrohError('unavailable', 'native unavailable'));

        await expect(acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [
                    { kind: 'iroh', ...endpoint },
                    { kind: 'https', url: 'HTTPS://Public.Example.test:443/api///?ignored=yes#fragment' },
                ],
            },
        })).resolves.toEqual({
            kind: 'https',
            runtimeOrigin: 'https://public.example.test/api',
        });
    });

    it('fails closed after the native supervisor starts a tunnel whose health probe fails', async () => {
        setHost('desktop');
        const releaseHomeTunnel = vi.fn(async () => undefined);
        const supervisor = createIrohHomeTunnelSupervisor({
            native: {
                ensureHomeTunnel: vi.fn(async (request: { homeServerIdentityId: string; endpointId: string }) => ({
                    leaseId: 'native-started-before-health-failure',
                    homeServerIdentityId: request.homeServerIdentityId,
                    homeEndpointId: request.endpointId,
                    runtimeOrigin: 'http://127.0.0.1:43124',
                    carrier: 'iroh' as const,
                    observedPath: 'direct' as const,
                    startedAtMs: 1,
                })),
                releaseHomeTunnel,
            },
            probe: async () => ({ ok: false, reason: 'health-unavailable' }),
        });

        const result = await acquireEligibleHomeCarrier({
            ...baseInput,
            acquireNative: async (input) => {
                const lease = await supervisor.ensureTunnel({
                    remoteHostId: input.homeServerIdentityId,
                    purpose: 'home',
                    homeServerIdentityId: input.homeServerIdentityId,
                    endpointId: input.endpoint.endpointId,
                    canonicalServerUrl: input.canonicalServerUrl,
                    policy: input.policy ?? 'automatic',
                    ...(input.endpoint.relayUrls ? { relayUrls: input.endpoint.relayUrls } : {}),
                    ...(input.endpoint.directAddresses ? { directAddresses: input.endpoint.directAddresses } : {}),
                    verification: input.verification,
                });
                if (!lease.localUrl) throw new Error('test supervisor returned no local origin');
                return {
                    ...lease,
                    runtimeOrigin: lease.localUrl,
                    release: async () => await supervisor.releaseTunnel(lease.leaseId),
                };
            },
        });

        expect(result).toMatchObject({ kind: 'fail_closed', fallbackAllowed: false });
        expect(releaseHomeTunnel).toHaveBeenCalledTimes(1);
        expect(releaseHomeTunnel).toHaveBeenCalledWith('native-started-before-health-failure');
        expect(supervisor.listTunnels().leases).toEqual([]);
    });

    it('does not let unavailable cleanup mask a post-acquisition health failure', async () => {
        setHost('desktop');
        const releaseHomeTunnel = vi.fn()
            .mockRejectedValueOnce(new IrohError('unavailable', 'desktop stop command unavailable'))
            .mockResolvedValueOnce(undefined);
        const supervisor = createIrohHomeTunnelSupervisor({
            native: {
                ensureHomeTunnel: vi.fn(async (request: { homeServerIdentityId: string; endpointId: string }) => ({
                    leaseId: 'native-started-before-cleanup-failure',
                    homeServerIdentityId: request.homeServerIdentityId,
                    homeEndpointId: request.endpointId,
                    runtimeOrigin: 'http://127.0.0.1:43125',
                    carrier: 'iroh' as const,
                    observedPath: 'direct' as const,
                    startedAtMs: 1,
                })),
                releaseHomeTunnel,
            },
            probe: async () => ({ ok: false, reason: 'health-unavailable' }),
        });

        const result = await acquireEligibleHomeCarrier({
            ...baseInput,
            acquireNative: async (input) => {
                const lease = await supervisor.ensureTunnel({
                    remoteHostId: input.homeServerIdentityId,
                    purpose: 'home',
                    homeServerIdentityId: input.homeServerIdentityId,
                    endpointId: input.endpoint.endpointId,
                    canonicalServerUrl: input.canonicalServerUrl,
                    policy: input.policy ?? 'automatic',
                    ...(input.endpoint.relayUrls ? { relayUrls: input.endpoint.relayUrls } : {}),
                    ...(input.endpoint.directAddresses ? { directAddresses: input.endpoint.directAddresses } : {}),
                    verification: input.verification,
                });
                if (!lease.localUrl) throw new Error('test supervisor returned no local origin');
                return {
                    ...lease,
                    runtimeOrigin: lease.localUrl,
                    release: async () => await supervisor.releaseTunnel(lease.leaseId),
                };
            },
        });

        expect(result).toMatchObject({ kind: 'fail_closed', fallbackAllowed: false });
        expect(releaseHomeTunnel).toHaveBeenCalledTimes(1);
        expect(supervisor.listTunnels().leases).toEqual([
            expect.objectContaining({ status: 'failed' }),
        ]);
        await supervisor.dispose();
        expect(releaseHomeTunnel).toHaveBeenCalledTimes(2);
    });

    it('treats missing browser carrier capability as unavailable without attempting the native carrier', async () => {
        setHost('no_shared_worker');

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toEqual({
            kind: 'https',
            runtimeOrigin: 'https://public.example.test',
        });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('treats an eligible browser host without relay reachability as unavailable without attempting either carrier', async () => {

        const result = await acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [{ kind: 'iroh', ...endpoint, relayUrls: [] }],
            },
        });

        expect(result).toMatchObject({
            kind: 'fail_closed',
            fallbackAllowed: true,
            error: { name: 'IrohError', code: 'unavailable' },
        });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('fails typed when the browser carrier is unsupported and no trusted HTTPS origin exists', async () => {
        setHost('no_shared_worker');

        const result = await acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [{ kind: 'iroh', ...endpoint }],
            },
        });

        expect(result).toMatchObject({
            kind: 'fail_closed',
            fallbackAllowed: true,
            error: { name: 'IrohError', code: 'unavailable' },
        });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['credential', { verification: { kind: 'authenticated' as const, token: '' } }],
        ['identity', { descriptor: { ...baseInput.descriptor, homeServerIdentityId: '' } }],
        ['endpoint', {
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [{ kind: 'iroh' as const, ...endpoint, endpointId: '' }],
            },
        }],
    ])('keeps a missing browser %s fail-closed', async (_name, override) => {
        const result = await acquireEligibleHomeCarrier({ ...baseInput, ...override });

        expect(result).toMatchObject({ kind: 'fail_closed', fallbackAllowed: false });
        expect(acquireBrowserSpy).not.toHaveBeenCalled();
        expect(acquireNativeSpy).not.toHaveBeenCalled();
    });

    it('returns fail-closed for identity failure even when HTTPS is independently trusted', async () => {
        const error = new IrohError('identity_mismatch', 'wrong endpoint');
        setHost('desktop');
        acquireNativeSpy.mockRejectedValue(error);

        await expect(acquireEligibleHomeCarrier(baseInput)).resolves.toEqual({
            kind: 'fail_closed',
            error,
            fallbackAllowed: false,
        });
    });

    it('fails closed as unavailable when an allowed fallback has no trusted HTTPS destination', async () => {
        const error = new IrohError('unavailable', 'native unavailable');
        setHost('desktop');
        acquireNativeSpy.mockRejectedValue(error);

        await expect(acquireEligibleHomeCarrier({
            ...baseInput,
            descriptor: {
                ...baseInput.descriptor,
                endpoints: [
                    { kind: 'iroh', ...endpoint },
                    { kind: 'https', url: 'http://not-independent.example.test' },
                ],
            },
        })).resolves.toEqual({
            kind: 'fail_closed',
            error,
            fallbackAllowed: true,
        });
    });
});
