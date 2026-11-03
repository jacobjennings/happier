import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConcurrentCacheNetworkHarness } from '@/dev/testkit/harness/concurrentCacheNetworkHarness';

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());

const h = await createConcurrentCacheNetworkHarness('cache-socket-retry');
beforeEach(() => h.reset());
afterEach(() => h.cleanup());
afterAll(() => h.dispose());

describe('persistent secondary socket retry', () => {
    it('recovers socket construction refusal through the existing cache reconciliation', async () => {
        let first = true;
        h.network.setSocketConfigurator(() => { if (first) { first = false; throw new Error('Socket construction refused'); } });
        try {
            h.startConcurrentSessionCacheSync();
            await vi.waitFor(() => expect(h.network.socketBoundaries).toHaveLength(1));
            h.network.setSocketConfigurator(() => {});
            await h.profiles.upsertServerProfile({ serverUrl: h.homeB.serverUrl, name: 'Retry B' });
            await h.ready();
            expect(h.socket().socket.connected).toBe(true);
        } finally { h.network.setSocketConfigurator(() => {}); }
    });
    it('retries a silent secondary dial after the canonical peer-liveness window', async () => {
        const { SERVER_PEER_LIVENESS_WINDOW_MS } = await import('@/sync/runtime/connectivity/serverReachabilityTuning');
        const dialTimes: number[] = [];
        h.network.setSocketConfigurator(boundary => boundary.socket.connect.mockImplementation(() => { dialTimes.push(Date.now()); }));
        vi.useFakeTimers();
        try {
            await h.start();
            expect(dialTimes).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(dialTimes[0] + SERVER_PEER_LIVENESS_WINDOW_MS + 250 - Date.now());
            expect(dialTimes).toHaveLength(2);
            expect(h.pool.peekServerReachabilityState(h.homeB.serverUrl, h.homeB.token)?.phase).toBe('online');
        } finally {
            h.stopConcurrentSessionCacheSync();
            h.network.setSocketConfigurator(() => {});
            vi.useRealTimers();
        }
    });
    it('keeps a resource denial scoped to the secondary snapshot read', async () => {
        await h.start(); await h.ready();
        h.setResponder(async input => new URL(String(input)).pathname === '/v2/sessions'
            ? new Response(null, { status: 403 }) : null);
        await h.refresh();
        expect(h.pool.peekServerReachabilityState(h.homeB.serverUrl, h.homeB.token)?.phase).toBe('online');
        expect(h.socket().socket.connected).toBe(true);
    });
    it.each([false, true])('retains escalating socket retry demand while HTTP stays online (prewarmed: %s)', async prewarmed => {
        let lease: Awaited<ReturnType<typeof h.pool.acquireServerReachabilitySupervisor>> | undefined;
        const dialTimes: number[] = [];
        const failureTimes: number[] = [];
        let healthy = false;
        h.network.setSocketConfigurator(boundary => {
            boundary.socket.connect.mockImplementation(() => {
                dialTimes.push(Date.now());
                if (healthy) boundary.trigger('connect');
                else setTimeout(() => { failureTimes.push(Date.now()); boundary.trigger('connect_error', new Error('WebSocket blocked')); }, 25);
            });
        });
        if (prewarmed) lease = await h.pool.acquireServerReachabilitySupervisor({ serverUrl: h.homeB.serverUrl, token: h.homeB.token });
        vi.useFakeTimers();
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            await h.start();
            await vi.waitFor(() => expect(dialTimes).toHaveLength(1));
            await vi.advanceTimersByTimeAsync(25);
            for (const delay of [250, 2000, 4000, 8000, 16000]) {
                const before = dialTimes.length;
                // Startup's waitFor advances its clock synchronously. Observe
                // each backoff in two phases after draining refusal delivery.
                await vi.advanceTimersByTimeAsync(delay / 2);
                expect(dialTimes).toHaveLength(before);
                await vi.advanceTimersByTimeAsync(delay / 2 + 25);
                expect(dialTimes, JSON.stringify({ now: Date.now(), dialTimes, failureTimes,
                    socketCount: h.network.socketBoundaries.length, state: h.pool.peekServerReachabilityState(h.homeB.serverUrl, h.homeB.token), timers: vi.getTimerCount() }))
                    .toHaveLength(before + 1);
            }
            expect(h.pool.peekServerReachabilityState(h.homeB.serverUrl, h.homeB.token)?.phase).toBe('online');
            const { createServerFetchAtEndpoint } = await import('@/sync/http/client');
            const request = createServerFetchAtEndpoint({ endpointUrl: h.homeB.serverUrl, credentials: { token: h.homeB.token }, superviseReachability: true });
            let admitted = false;
            const http = Promise.all([request('/v1/machines'), request('/ordinary-write', { method: 'POST' })]).then(() => { admitted = true; });
            await vi.advanceTimersByTimeAsync(0);
            expect(admitted).toBe(true);
            await http;
            h.pool.setServerReachabilityNetworkAllowed(false);
            const paused = dialTimes.length;
            const { DEFAULT_MANAGED_CONNECTION_POLICY: policy } = await import('@happier-dev/connection-supervisor');
            await vi.advanceTimersByTimeAsync(policy.backoffMaxMs * (1 + policy.jitterRatio) + 25);
            expect(dialTimes).toHaveLength(paused);
            healthy = true;
            h.pool.setServerReachabilityNetworkAllowed(true);
            await vi.advanceTimersByTimeAsync(0);
            await vi.waitFor(() => expect(dialTimes.length).toBeGreaterThan(paused));
            await h.ready();
            h.socket().trigger('disconnect', 'transport close');
            const connected = dialTimes.length;
            await vi.advanceTimersByTimeAsync(249);
            expect(dialTimes).toHaveLength(connected);
            await vi.advanceTimersByTimeAsync(1);
            expect(dialTimes).toHaveLength(connected + 1);
            h.stopConcurrentSessionCacheSync();
            const stopped = dialTimes.length;
            await vi.advanceTimersByTimeAsync(policy.backoffMaxMs * (1 + policy.jitterRatio) + 25);
            expect(dialTimes).toHaveLength(stopped);
        } finally {
            h.stopConcurrentSessionCacheSync();
            await lease?.release();
            h.network.setSocketConfigurator(() => {});
            random.mockRestore();
            vi.useRealTimers();
        }
    });
});
