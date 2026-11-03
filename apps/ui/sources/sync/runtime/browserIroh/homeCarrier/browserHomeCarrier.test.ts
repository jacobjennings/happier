import { describe, expect, it, vi } from 'vitest';

import type { BrowserIrohEndpointClient, BrowserIrohLease, BrowserIrohStream } from '../endpointClient';
import { BrowserIrohClientError } from '../endpointClient';
import {
    resolveBrowserIrohHomeCarrierEligibility,
    type BrowserIrohHomeCarrierRequest,
    type BrowserIrohHomeCarrierRequestCommon,
} from './browserHomeCarrier';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { createBrowserIrohHomeCarrierOwner } from './browserHomeCarrierRuntime';
import { readIrohHomeTransportDiagnostics } from '@/sync/runtime/irohHomeTransportDiagnostics';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeWebMock();
});

const HOME_ENDPOINT_ID = 'a'.repeat(64);
const OTHER_ENDPOINT_ID = 'b'.repeat(64);
const RELAY_URLS = ['https://relay.happier.test/'] as const;
const CANONICAL_URL = 'https://home.example.test';

/**
 * Every case here is an ordinary authenticated Home request, so the overrides are
 * typed against that arm: `Partial` of the whole union admits an enrollment shape
 * the spread below can never produce.
 */
function request(
    overrides: Partial<BrowserIrohHomeCarrierRequestCommon & Readonly<{ credentials: AuthCredentials }>> = {},
): BrowserIrohHomeCarrierRequest {
    return {
        homeServerIdentityId: 'home-identity',
        endpoint: { endpointId: HOME_ENDPOINT_ID, relayUrls: [...RELAY_URLS] },
        canonicalServerUrl: CANONICAL_URL,
        credentials: { token: 'home-token' },
        ...overrides,
    };
}

function enrollmentRequest(): BrowserIrohHomeCarrierRequest {
    return {
        purpose: 'enrollment',
        homeServerIdentityId: 'home-identity',
        endpoint: { endpointId: HOME_ENDPOINT_ID, relayUrls: [...RELAY_URLS] },
        canonicalServerUrl: CANONICAL_URL,
    };
}

type OpenedStream = Readonly<{
    streamKind: string;
    endpointId: string;
    relayUrls: readonly string[];
}>;

/**
 * The worker port is this owner's only system boundary, so the fake stands in
 * for the SharedWorker/wasm endpoint and nothing else: real HTTP/1.1 bytes are
 * queued in and recorded out, and every lease/stream rule below is exercised
 * against the real carrier implementation.
 */
function createFakeEndpointClient(options: Readonly<{
    remoteEndpointId?: string;
    releaseFailures?: number;
}> = {}) {
    const opened: OpenedStream[] = [];
    const acquiredRelayUrls: Array<readonly string[]> = [];
    const releasedLeaseIds: string[] = [];
    const writtenByStream = new Map<string, number[]>();
    const cancelledStreams: string[] = [];
    const queuedResponses: string[] = [];
    let leaseSequence = 0;
    let streamSequence = 0;
    let remainingReleaseFailures = options.releaseFailures ?? 0;

    function makeStream(streamId: string): BrowserIrohStream {
        const pending = queuedResponses.shift() ?? '';
        let outbox = new TextEncoder().encode(pending);
        writtenByStream.set(streamId, []);
        return {
            streamId,
            remoteEndpointId: options.remoteEndpointId ?? HOME_ENDPOINT_ID,
            observedPath: 'relay',
            read: async (maxBytes) => {
                if (outbox.byteLength === 0) return { bytes: new Uint8Array(), done: true };
                const size = Math.min(maxBytes, outbox.byteLength);
                const bytes = outbox.subarray(0, size);
                outbox = outbox.subarray(size);
                return { bytes, done: false };
            },
            write: async (bytes) => {
                writtenByStream.get(streamId)?.push(...bytes);
            },
            finishWrite: async () => {},
            cancel: async () => {
                cancelledStreams.push(streamId);
            },
            close: async () => {},
        };
    }

    const client: BrowserIrohEndpointClient = {
        acquireLease: async (relayUrls) => {
            acquiredRelayUrls.push([...relayUrls]);
            leaseSequence += 1;
            const leaseId = `lease-${leaseSequence}`;
            const lease: BrowserIrohLease = {
                leaseId,
                endpointId: 'local-browser-endpoint',
                appliedRelayUrls: [...relayUrls],
                openStream: async (input) => {
                    opened.push({
                        streamKind: input.streamKind,
                        endpointId: input.endpointId,
                        relayUrls: [...input.relayUrls],
                    });
                    streamSequence += 1;
                    return makeStream(`stream-${streamSequence}`);
                },
                release: async () => {
                    if (remainingReleaseFailures > 0) {
                        remainingReleaseFailures -= 1;
                        throw new BrowserIrohClientError('endpoint_unavailable', 'release failed');
                    }
                    releasedLeaseIds.push(leaseId);
                },
            };
            return lease;
        },
        status: async () => ({
            state: 'ready',
            endpointId: 'local-browser-endpoint',
            appliedRelayUrls: [...RELAY_URLS],
            leaseCount: leaseSequence,
        }),
        releaseAll: async () => {},
        close: () => {},
    };

    return {
        client,
        opened,
        acquiredRelayUrls,
        releasedLeaseIds,
        cancelledStreams,
        queueResponse: (raw: string) => queuedResponses.push(raw),
        writtenText: (streamId: string) =>
            new TextDecoder().decode(Uint8Array.from(writtenByStream.get(streamId) ?? [])),
        allWrittenText: () => [...writtenByStream.values()]
            .map((bytes) => new TextDecoder().decode(Uint8Array.from(bytes)))
            .join(''),
    };
}

describe('browser Iroh Home carrier eligibility', () => {
    it('selects the browser carrier only for a browser host with an exact endpoint and explicit relays', () => {
        expect(resolveBrowserIrohHomeCarrierEligibility(request(), { eligible: true }))
            .toEqual({ eligible: true, endpointId: HOME_ENDPOINT_ID, relayUrls: [...RELAY_URLS] });
    });

    it('permits credentialless enrollment only through the explicit enrollment scope', () => {
        expect(resolveBrowserIrohHomeCarrierEligibility(enrollmentRequest(), { eligible: true }))
            .toEqual({ eligible: true, endpointId: HOME_ENDPOINT_ID, relayUrls: [...RELAY_URLS] });

        expect(resolveBrowserIrohHomeCarrierEligibility(
            { ...enrollmentRequest(), purpose: 'authenticated_home', credentials: { token: '' } },
            { eligible: true },
        )).toEqual({ eligible: false, reason: 'credential_missing' });
    });

    it('never selects the browser carrier on a native or desktop host', () => {
        // Tauri/Electron run the same web bundle but keep the native carrier,
        // which can bind a loopback listener and use direct paths.
        expect(resolveBrowserIrohHomeCarrierEligibility(
            request(),
            { eligible: false, reason: 'desktop_host' },
        )).toEqual({ eligible: false, reason: 'host_ineligible' });
    });

    it('requires an exact Home identity, a Home-scoped credential, an endpoint, and relays', () => {
        expect(resolveBrowserIrohHomeCarrierEligibility(
            request({ homeServerIdentityId: '  ' }),
            { eligible: true },
        )).toEqual({ eligible: false, reason: 'identity_missing' });

        expect(resolveBrowserIrohHomeCarrierEligibility(
            request({ credentials: { token: '' } }),
            { eligible: true },
        )).toEqual({ eligible: false, reason: 'credential_missing' });

        expect(resolveBrowserIrohHomeCarrierEligibility(
            request({ endpoint: { endpointId: '   ' } }),
            { eligible: true },
        )).toEqual({ eligible: false, reason: 'endpoint_missing' });

        // Relay reachability is the browser's only path: there is no direct
        // transport to fall back on, so an endpoint without relays is not usable.
        expect(resolveBrowserIrohHomeCarrierEligibility(
            request({ endpoint: { endpointId: HOME_ENDPOINT_ID, relayUrls: [] } }),
            { eligible: true },
        )).toEqual({ eligible: false, reason: 'relays_missing' });

        expect(resolveBrowserIrohHomeCarrierEligibility(
            request({ endpoint: { endpointId: HOME_ENDPOINT_ID, directAddresses: ['203.0.113.4:4433'] } }),
            { eligible: true },
        )).toEqual({ eligible: false, reason: 'relays_missing' });
    });
});

describe('browser Iroh Home carrier acquisition', () => {
    it('acquires one lease per Home from the one shared endpoint client', async () => {
        const fake = createFakeEndpointClient();
        const resolveEndpointClient = vi.fn(() => fake.client);
        const owner = createBrowserIrohHomeCarrierOwner({ resolveEndpointClient, hostDecision: () => ({ eligible: true }) });

        const first = await owner.acquire(request());
        const second = await owner.acquire(request({
            homeServerIdentityId: 'other-home',
            endpoint: { endpointId: OTHER_ENDPOINT_ID, relayUrls: ['https://relay-2.happier.test/'] },
            canonicalServerUrl: 'https://other.example.test',
        }));

        expect(resolveEndpointClient).toHaveBeenCalledTimes(1);
        expect(first.leaseId).not.toBe(second.leaseId);
        expect(fake.acquiredRelayUrls).toEqual([
            [...RELAY_URLS],
            ['https://relay-2.happier.test/'],
        ]);
        expect(first.endpointId).toBe(HOME_ENDPOINT_ID);
        expect(second.endpointId).toBe(OTHER_ENDPOINT_ID);
    });

    it('carries an authenticated request over one home stream to the exact selected endpoint', async () => {
        const fake = createFakeEndpointClient();
        fake.queueResponse('HTTP/1.1 200 OK\r\ncontent-length: 4\r\n\r\npong');
        const owner = createBrowserIrohHomeCarrierOwner({ resolveEndpointClient: () => fake.client, hostDecision: () => ({ eligible: true }) });
        const carrier = await owner.acquire(request());

        const response = await carrier.request(`${CANONICAL_URL}/v1/auth/ping`, {
            method: 'GET',
            headers: { Authorization: 'Bearer home-token' },
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('pong');
        expect(fake.opened).toEqual([{
            streamKind: 'home',
            endpointId: HOME_ENDPOINT_ID,
            relayUrls: [...RELAY_URLS],
        }]);
        const written = fake.writtenText('stream-1');
        expect(written).toContain('GET /v1/auth/ping HTTP/1.1');
        expect(written).toContain('host: home.example.test');
        expect(written).toContain('Bearer home-token');
    });

    it('reports a truthful path: unknown before a stream proves one, relay after, never direct', async () => {
        const fake = createFakeEndpointClient();
        fake.queueResponse('HTTP/1.1 204 No Content\r\n\r\n');
        const owner = createBrowserIrohHomeCarrierOwner({ resolveEndpointClient: () => fake.client, hostDecision: () => ({ eligible: true }) });
        const carrier = await owner.acquire(request());

        expect(carrier.readObservedPath()).toBe('unknown');
        expect(readIrohHomeTransportDiagnostics().find(
            (entry) => entry.homeServerIdentityId === 'home-identity',
        )).toMatchObject({
            remoteEndpointId: HOME_ENDPOINT_ID,
            state: 'connecting',
            effectiveConfiguration: {
                policy: 'automatic',
                relayUrls: ['https://relay.happier.test'],
                directAddressCount: 0,
            },
        });
        expect(readIrohHomeTransportDiagnostics().find(
            (entry) => entry.homeServerIdentityId === 'home-identity',
        )?.current).toBeUndefined();
        await carrier.request(`${CANONICAL_URL}/v1/auth/ping`, { method: 'GET' });
        expect(carrier.readObservedPath()).toBe('relay');
        expect(readIrohHomeTransportDiagnostics().find(
            (entry) => entry.homeServerIdentityId === 'home-identity',
        )).toMatchObject({
            state: 'connected',
            current: { carrier: 'iroh', observedPath: 'relay' },
        });
    });

    it('binds the WebSocket facility to the same proven endpoint and relay set', async () => {
        const fake = createFakeEndpointClient();
        const owner = createBrowserIrohHomeCarrierOwner({ resolveEndpointClient: () => fake.client, hostDecision: () => ({ eligible: true }) });
        const carrier = await owner.acquire(request());

        const socket = carrier.createWebSocket(`${CANONICAL_URL.replace('https', 'wss')}/v1/updates/?EIO=4&transport=websocket`) as {
            url: string;
            readyState: number;
            close: (code?: number) => void;
        };

        expect(typeof socket.close).toBe('function');
        await vi.waitFor(() => expect(fake.opened).toHaveLength(1));
        expect(fake.opened[0]).toEqual({
            streamKind: 'home',
            endpointId: HOME_ENDPOINT_ID,
            relayUrls: [...RELAY_URLS],
        });
        socket.close();
    });
});

describe('browser Iroh Home carrier release', () => {
    it('releases only the owning Home lease and is idempotent', async () => {
        const fake = createFakeEndpointClient();
        const owner = createBrowserIrohHomeCarrierOwner({ resolveEndpointClient: () => fake.client, hostDecision: () => ({ eligible: true }) });
        const first = await owner.acquire(request());
        await owner.acquire(request({
            homeServerIdentityId: 'other-home',
            endpoint: { endpointId: OTHER_ENDPOINT_ID, relayUrls: ['https://relay-2.happier.test/'] },
        }));

        await first.release();
        await first.release();

        expect(fake.releasedLeaseIds).toEqual(['lease-1']);
    });

    it('retains custody of a failed release so a later attempt retries it', async () => {
        const fake = createFakeEndpointClient({ releaseFailures: 1 });
        const owner = createBrowserIrohHomeCarrierOwner({ resolveEndpointClient: () => fake.client, hostDecision: () => ({ eligible: true }) });
        const carrier = await owner.acquire(request());

        await expect(carrier.release()).rejects.toThrow(/release failed/u);
        expect(fake.releasedLeaseIds).toEqual([]);

        await carrier.release();
        expect(fake.releasedLeaseIds).toEqual(['lease-1']);
    });
});

describe('browser Iroh Home carrier tab singleton', () => {
    it('shares the packaged per-tab endpoint client with the machine operations', async () => {
        // The tab's one packaged SharedWorker boundary: constructions and
        // posted commands are recorded, and every command is answered with a
        // canned error reply so no caller hangs on a silent port.
        const constructions: { url: string }[] = [];
        const commandsByPort: { kind: string }[][] = [];
        class RecordingSharedWorker {
            onerror: ((event: unknown) => void) | null = null;
            readonly port: {
                postMessage: (message: unknown) => void;
                addEventListener: (
                    type: string,
                    listener: (event: { data: unknown }) => void,
                ) => void;
            };

            constructor(scriptUrl: string, _options?: { type?: 'module'; name?: string }) {
                constructions.push({ url: scriptUrl });
                const commands: { kind: string }[] = [];
                commandsByPort.push(commands);
                let listener: ((event: { data: unknown }) => void) | null = null;
                this.port = {
                    postMessage: (message) => {
                        const command = message as { kind: string; requestId: string };
                        commands.push({ kind: command.kind });
                        listener?.({
                            data: {
                                v: 1,
                                kind: 'error',
                                requestId: command.requestId,
                                code: 'endpoint_unavailable',
                                message: 'recording stub has no endpoint',
                            },
                        });
                    },
                    addEventListener: (_type, attached) => {
                        listener = attached;
                    },
                };
            }
        }
        vi.stubGlobal('SharedWorker', RecordingSharedWorker);
        // The packaged client resolves assets from `location.origin` (the
        // deployment base), never from the navigation `href` — so the stub
        // must describe the real browser surface: both are always present.
        vi.stubGlobal('location', {
            origin: 'https://app.example.test',
            href: 'https://app.example.test/home',
        });
        vi.resetModules();
        try {
            // Fresh tab: fresh runtime singleton and fresh endpoint-client
            // singleton, sharing this module graph after the reset.
            const { browserIrohHomeCarrierOwner } = await import('./browserHomeCarrierRuntime');
            const { resolvePackagedBrowserIrohEndpointClient } = await import('../endpointClient');

            // The real eligibility path admits the acquisition on this mocked
            // web host; the stub port answers with a typed error.
            const owner = browserIrohHomeCarrierOwner();
            await expect(owner.acquire(request()))
                .rejects.toMatchObject({ name: 'BrowserIrohClientError' });
            await expect(resolvePackagedBrowserIrohEndpointClient().status())
                .rejects.toMatchObject({ name: 'BrowserIrohClientError' });

            // One SharedWorker port for the tab, and the Home acquisition and
            // the machine-side accessor both traveled on it.
            expect(constructions).toHaveLength(1);
            expect(constructions[0]?.url).toBe(
                'https://app.example.test/vendor/iroh/happier-iroh-worker.js',
            );
            expect(commandsByPort[0]?.map((command) => command.kind)).toEqual([
                'acquireLease',
                'status',
            ]);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
