import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSocketIoBoundaryStub } from '@/dev/testkit/mocks/socketIo';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';

const io = vi.hoisted(() => vi.fn());
vi.mock('socket.io-client', () => ({ io }));

// Only the Socket.IO and HTTP network boundaries are replaced. Both connection
// supervisors, the transport adapter, runtime target and apiSocket remain real.
const { apiSocket } = await import('./apiSocket');
const pool = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
const { createServerFetchAtEndpoint } = await import('@/sync/http/client');

afterEach(async () => {
    apiSocket.disconnect();
    await pool.resetServerReachabilitySupervisors();
    resetRuntimeFetch();
    vi.useRealTimers();
    vi.restoreAllMocks();
    io.mockReset();
});

describe('active socket managed retry', () => {
    it('settles a silent dial and retries within the server peer-liveness contract', async () => {
        const endpoint = 'https://active-black-hole.example.test';
        setRuntimeFetch(async () => new Response(null, { status: 200 }));
        await upsertAndActivateServer({ serverUrl: endpoint });
        vi.useFakeTimers();
        const sockets: ReturnType<typeof createSocketIoBoundaryStub>[] = [];
        io.mockImplementation(() => {
            const boundary = createSocketIoBoundaryStub({ autoConnect: false });
            sockets.push(boundary);
            return boundary.socket;
        });
        const statuses: string[] = [];
        const unsubscribe = apiSocket.onStatusChange(status => statuses.push(status));
        try {
            apiSocket.initialize({ endpoint, token: 'black-hole-token' }, null);
            await vi.advanceTimersByTimeAsync(0);
            expect(statuses.at(-1)).toBe('connecting');
            // Same peer-liveness contract as the server's 15s ping + 45s timeout.
            await vi.advanceTimersByTimeAsync(15_000 + 45_000);
            expect(statuses.at(-1)).not.toBe('connecting');
            expect(sockets).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(250);
            expect(sockets).toHaveLength(2);
            apiSocket.disconnect();
            await vi.advanceTimersByTimeAsync(120_000);
            expect(sockets).toHaveLength(2);
            expect(statuses.at(-1)).toBe('disconnected');
        } finally { unsubscribe(); }
    });

    it('retains escalating failed-dial demand while HTTP stays ready, then resets after a real connection', async () => {
        const endpoint = 'https://active-retry.example.test';
        const token = 'active-retry-token';
        const issued: string[] = [];
        setRuntimeFetch(async (url, init) => {
            issued.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`);
            return new Response(null, { status: 200 });
        });
        await upsertAndActivateServer({ serverUrl: endpoint });
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const sockets: ReturnType<typeof createSocketIoBoundaryStub>[] = [];
        let healthy = false;
        io.mockImplementation(() => {
            const boundary = createSocketIoBoundaryStub({ autoConnect: false });
            boundary.socket.connect.mockImplementation(() => {
                boundary.socket.active = true;
                if (healthy) boundary.trigger('connect');
                else setTimeout(() => boundary.trigger('connect_error', new Error('WebSocket blocked')), 25);
            });
            sockets.push(boundary);
            return boundary.socket;
        });
        const statuses: string[] = [];
        const unsubscribe = apiSocket.onStatusChange(status => statuses.push(status));
        try {
            apiSocket.initialize({ endpoint, token }, null);
            await vi.advanceTimersByTimeAsync(25);
            expect(statuses.at(-1)).not.toBe('connecting');
            expect(pool.peekServerReachabilityState(endpoint, token)?.phase).toBe('online');
            expect(sockets).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(249);
            expect(sockets).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(26);
            expect(sockets).toHaveLength(2);
            // A second failure uses the policy's 2s backoff, not another fast
            // retry or a fresh HTTP-ready observation resetting the attempt.
            await vi.advanceTimersByTimeAsync(1_999);
            expect(sockets).toHaveLength(2);
            await vi.advanceTimersByTimeAsync(26);
            expect(sockets).toHaveLength(3);
            expect(statuses.at(-1)).not.toBe('connecting');
            // Keep refusing beyond the ordinary HTTP admission budget. Socket
            // retry demand must never become a pooled HTTP-offline verdict.
            for (const backoff of [4_000, 8_000, 16_000]) {
                const count = sockets.length;
                await vi.advanceTimersByTimeAsync(backoff - 1);
                expect(sockets).toHaveLength(count);
                await vi.advanceTimersByTimeAsync(26);
                expect(sockets).toHaveLength(count + 1);
            }
            const request = createServerFetchAtEndpoint({ endpointUrl: endpoint, credentials: { token } });
            let admitted = false;
            const http = Promise.all([
                request('/ordinary-read', undefined, { retry: 'none' }),
                request('/ordinary-write', { method: 'POST' }, { retry: 'none' }),
            ]).then(() => { admitted = true; });
            await vi.advanceTimersByTimeAsync(0);
            expect(admitted).toBe(true);
            expect(issued).toContain('GET /ordinary-read');
            expect(issued).toContain('POST /ordinary-write');
            await http;
            expect(pool.peekServerReachabilityState(endpoint, token)?.phase).toBe('online');
            await vi.advanceTimersByTimeAsync(31_999);
            expect(sockets).toHaveLength(6);
            healthy = true;
            await vi.advanceTimersByTimeAsync(1);
            expect(sockets).toHaveLength(7);
            expect(statuses.at(-1)).toBe('connected');
            expect(pool.peekServerReachabilityState(endpoint, token)?.phase).toBe('online');
            sockets.at(-1)!.trigger('disconnect', 'transport close');
            await vi.advanceTimersByTimeAsync(249);
            expect(sockets).toHaveLength(7);
            await vi.advanceTimersByTimeAsync(1);
            expect(sockets).toHaveLength(8);
            expect(statuses.at(-1)).toBe('connected');
            await vi.advanceTimersByTimeAsync(60_000);
            expect(sockets).toHaveLength(8);
            apiSocket.disconnect();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(sockets).toHaveLength(8);
            // Explicit Retry re-admits a transport after intentional teardown.
            apiSocket.connect();
            await vi.advanceTimersByTimeAsync(0);
            expect(statuses.at(-1)).toBe('connected');
        } finally {
            unsubscribe();
        }
    });
});
