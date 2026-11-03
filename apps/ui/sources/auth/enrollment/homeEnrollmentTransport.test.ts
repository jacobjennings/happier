import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveHomeEnrollmentTransport } from './homeEnrollmentTransport';

const releaseSpy = vi.hoisted(() => vi.fn(async () => {}));
const acquireIrohHomeRuntimeOriginSpy = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>());
const createServerFetchAtEndpointSpy = vi.hoisted(() => vi.fn<(input: unknown) => ReturnType<typeof vi.fn>>(() => vi.fn()));
const resolveBrowserEligibilitySpy = vi.hoisted(() => vi.fn());
const acquireBrowserIrohHomeCarrierSpy = vi.hoisted(() => vi.fn());
const browserReleaseSpy = vi.hoisted(() => vi.fn(async () => {}));
const resolveBrowserHostDecisionSpy = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/browserIroh/hostEligibility', () => ({
    resolveBrowserIrohHostDecision: () => resolveBrowserHostDecisionSpy(),
}));

vi.mock('@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier', () => ({
    resolveBrowserIrohHomeCarrierEligibility: (...args: unknown[]) => resolveBrowserEligibilitySpy(...args),
    acquireBrowserIrohHomeCarrier: (input: unknown) => acquireBrowserIrohHomeCarrierSpy(input),
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireIrohHomeRuntimeOriginSpy(input),
}));

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (input: unknown) => createServerFetchAtEndpointSpy(input),
}));

describe('resolveHomeEnrollmentTransport', () => {
    beforeEach(() => {
        acquireIrohHomeRuntimeOriginSpy.mockReset();
        acquireIrohHomeRuntimeOriginSpy.mockResolvedValue({
            leaseId: 'lease-home-b',
            localUrl: 'http://127.0.0.1:43123',
            runtimeOrigin: 'http://127.0.0.1:43123',
            homeServerIdentityId: 'srv_home_b',
            endpointId: 'iroh-home-b',
            carrier: 'iroh',
            observedPath: 'direct',
            status: 'ready',
            release: releaseSpy,
        });
        releaseSpy.mockClear();
        createServerFetchAtEndpointSpy.mockClear();
        resolveBrowserEligibilitySpy.mockReset();
        resolveBrowserEligibilitySpy.mockReturnValue({ eligible: false, reason: 'host_ineligible' });
        resolveBrowserHostDecisionSpy.mockReset();
        resolveBrowserHostDecisionSpy.mockReturnValue({ eligible: false, reason: 'desktop_host' });
        acquireBrowserIrohHomeCarrierSpy.mockReset();
        browserReleaseSpy.mockClear();
    });

    it('acquires the shared browser carrier for credentialless enrollment without inventing a runtime origin', async () => {
        const homeCarrier = {
            leaseId: 'browser-lease-home-b',
            homeServerIdentityId: 'srv_home_b',
            endpointId: 'iroh-home-b',
            appliedRelayUrls: ['https://relay.example.test/'],
            readObservedPath: () => 'relay' as const,
            request: vi.fn(),
            createWebSocket: vi.fn(),
            release: browserReleaseSpy,
        };
        resolveBrowserEligibilitySpy.mockReturnValueOnce({
            eligible: true,
            endpointId: 'iroh-home-b',
            relayUrls: ['https://relay.example.test/'],
        });
        resolveBrowserHostDecisionSpy.mockReturnValueOnce({ eligible: true });
        acquireBrowserIrohHomeCarrierSpy.mockResolvedValueOnce(homeCarrier);
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 7,
            endpoints: [{
                kind: 'iroh' as const,
                endpointId: 'iroh-home-b',
                relayUrls: ['https://relay.example.test/'],
            }],
        };

        const result = await resolveHomeEnrollmentTransport(descriptor);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const expectedRequest = {
            purpose: 'enrollment',
            homeServerIdentityId: 'srv_home_b',
            endpoint: descriptor.endpoints[0],
            canonicalServerUrl: 'http://localhost:3010',
        };
        expect(resolveBrowserEligibilitySpy).toHaveBeenCalledWith(expectedRequest, { eligible: true });
        expect(acquireBrowserIrohHomeCarrierSpy).toHaveBeenCalledWith(expectedRequest);
        expect(acquireIrohHomeRuntimeOriginSpy).not.toHaveBeenCalled();
        expect(result.transport).toMatchObject({
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: null,
            carrier: 'iroh',
            authenticatedCredentialDestination: { kind: 'iroh', endpointId: 'iroh-home-b' },
            homeCarrier: { ...homeCarrier, release: expect.any(Function) },
        });
        result.transport.createRequest({ credentials: null });
        expect(createServerFetchAtEndpointSpy).toHaveBeenCalledWith({
            endpointUrl: 'http://localhost:3010',
            homeCarrier: { ...homeCarrier, release: expect.any(Function) },
            serverId: 'srv_home_b',
            credentials: null,
        });
        await Promise.all([result.transport.close(), result.transport.close()]);
        expect(browserReleaseSpy).toHaveBeenCalledTimes(1);
    });

    it('selects one public HTTPS application endpoint while retaining canonical identity', async () => {
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [
                { kind: 'https' as const, url: 'http://localhost:3010' },
                { kind: 'https' as const, url: 'https://home-b.test' },
            ],
        };
        const result = await resolveHomeEnrollmentTransport(descriptor);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.transport).toMatchObject({
            descriptor,
            canonicalServerUrl: 'http://localhost:3010',
            homeServerIdentityId: 'srv_home_b',
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: 'https://home-b.test',
            carrier: 'https',
            authenticatedCredentialDestination: {
                kind: 'https',
                applicationUrl: 'https://home-b.test',
            },
        });
        await result.transport.close();
        expect(releaseSpy).not.toHaveBeenCalled();
    });

    it('acquires a verified lease for pure Iroh while requests retain stable canonical identity', async () => {
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 7,
            endpoints: [{ kind: 'iroh' as const, endpointId: 'iroh-home-b' }],
        };
        const result = await resolveHomeEnrollmentTransport(descriptor);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledWith({
            homeServerIdentityId: 'srv_home_b',
            endpoint: descriptor.endpoints[0],
            canonicalServerUrl: 'http://localhost:3010',
            verification: { kind: 'enrollment' },
        });
        expect(result.transport.authenticatedCredentialDestination).toEqual({
            kind: 'iroh',
            endpointId: 'iroh-home-b',
        });
        result.transport.createRequest({ serverId: 'srv_home_b', credentials: null });
        expect(createServerFetchAtEndpointSpy).toHaveBeenCalledWith({
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: 'http://127.0.0.1:43123',
            serverId: 'srv_home_b',
            credentials: null,
        });
        await Promise.all([result.transport.close(), result.transport.close()]);
        expect(releaseSpy).toHaveBeenCalledTimes(1);
    });

    it('fails closed on an Iroh identity mismatch even when an independent HTTPS endpoint exists', async () => {
        acquireIrohHomeRuntimeOriginSpy.mockRejectedValueOnce(
            Object.assign(new Error('identity mismatch'), { name: 'IrohError', code: 'identity_mismatch' }),
        );
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [
                { kind: 'iroh', endpointId: 'iroh-home-b' },
                { kind: 'https', url: 'https://home-b.test' },
            ],
        });
        expect(result).toEqual({
            ok: false,
            homeServerIdentityId: 'srv_home_b',
            reason: 'iroh_transport_failed_closed',
        });
        expect(releaseSpy).not.toHaveBeenCalled();
        expect(createServerFetchAtEndpointSpy).not.toHaveBeenCalled();
    });

    it('fails closed when the acquired Iroh lease does not authenticate the selected descriptor endpoint', async () => {
        releaseSpy.mockRejectedValueOnce(new Error('release failed'));
        // Ready and identity-matching, so only the EndpointId mismatch can close it.
        acquireIrohHomeRuntimeOriginSpy.mockResolvedValueOnce({
            leaseId: 'lease-wrong-endpoint',
            localUrl: 'http://127.0.0.1:43123',
            runtimeOrigin: 'http://127.0.0.1:43123',
            homeServerIdentityId: 'srv_home_b',
            endpointId: 'iroh-home-c',
            carrier: 'iroh',
            observedPath: 'direct',
            status: 'ready',
            release: releaseSpy,
        });
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: 'iroh-home-b' }],
        });
        expect(result).toEqual({
            ok: false,
            homeServerIdentityId: 'srv_home_b',
            reason: 'iroh_transport_failed_closed',
        });
        expect(releaseSpy).toHaveBeenCalledOnce();
        expect(createServerFetchAtEndpointSpy).not.toHaveBeenCalled();
    });

    it('fails typed without requesting canonical loopback when pure Iroh acquisition fails', async () => {
        acquireIrohHomeRuntimeOriginSpy.mockRejectedValueOnce(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: 'iroh-home-b' }],
        });
        expect(result).toEqual({
            ok: false,
            homeServerIdentityId: 'srv_home_b',
            reason: 'iroh_transport_unavailable',
        });
        expect(createServerFetchAtEndpointSpy).not.toHaveBeenCalled();
    });

    it('uses an already resolved runtime origin without double-acquiring Iroh', async () => {
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://home-b.test',
            revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: 'iroh-home-b' }],
        }, { runtimeOrigin: 'http://localhost:43123' });
        expect(result.ok && result.transport.runtimeOrigin).toBe('http://localhost:43123');
        expect(acquireIrohHomeRuntimeOriginSpy).not.toHaveBeenCalled();
    });

    it('keeps a supplied descriptor-declared HTTPS origin distinct from the canonical audience', async () => {
        const result = await resolveHomeEnrollmentTransport({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://canonical.home-b.test',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://ingress.home-b.test' }],
        }, {
            runtimeOrigin: 'https://ingress.home-b.test',
            runtimeCarrier: 'https',
        });

        expect(result).toMatchObject({ ok: true, transport: {
            endpointUrl: 'https://canonical.home-b.test',
            runtimeOrigin: 'https://ingress.home-b.test',
            authenticatedCredentialDestination: {
                kind: 'https',
                applicationUrl: 'https://ingress.home-b.test',
            },
        } });
    });
});
