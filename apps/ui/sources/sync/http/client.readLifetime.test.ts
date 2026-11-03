import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbortController as NativeAbortController } from 'abort-controller';
import { createDeferred } from '@/dev/testkit';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { isTransientConnectivityError } from '@/sync/runtime/connectivity/transientConnectivityErrors';
import { abortServerFetches, createServerFetchAtEndpoint, serverFetch } from './client';
import { InvalidateSync } from '@/utils/sessions/sync';
import { kvBulkGet } from '@/sync/api/account/apiKv';

const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { get OS() { return platform.OS; } } });
});

afterEach(() => {
    abortServerFetches();
    resetRuntimeFetch();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    platform.OS = 'web';
});

describe('captured Home recovery read lifetime', () => {
    it('replaces a superseded InvalidateSync read immediately without backoff or consuming its failure budget', async () => {
        vi.useFakeTimers();
        const entered = createDeferred<void>();
        let requests = 0;
        let release: (() => void) | undefined;
        setRuntimeFetch(async (_url, init) => {
            requests += 1;
            if (requests > 1) return Response.json({ ok: true });
            return await new Promise<Response>((_resolve, reject) => {
                release = () => reject(new DOMException('Aborted', 'AbortError'));
                init?.signal?.addEventListener('abort', release, { once: true });
                entered.resolve();
            });
        });
        const request = createServerFetchAtEndpoint({ endpointUrl: 'https://invalidation-retry.example.test', credentials: null });
        const retries = vi.fn();
        const sync = new InvalidateSync(async () => { await request('/read', undefined, { retry: 'none' }); }, {
            backoff: { minDelayMs: 1_000, maxDelayMs: 1_000, maxFailureCount: 1 }, onRetry: retries,
        });
        let settled = false;
        const pending = sync.invalidateAndAwait().then(() => { settled = true; }, error => { throw error; });
        void pending.catch(() => {});
        try {
            await entered.promise;
            abortServerFetches('manual-retry', { readOnly: true });
            await vi.advanceTimersByTimeAsync(0);
            expect(requests).toBe(2);
            expect(settled).toBe(true);
            expect(retries).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            await pending;
        } finally { release?.(); sync.stop(); await pending.catch(() => {}); }
    });

    it.each(['headers', 'body'] as const)('releases the real KV POST read during manual Retry at %s without a retry delay', async phase => {
        await upsertAndActivateServer({ serverUrl: `https://kv-${phase}.example.test` });
        platform.OS = 'android';
        vi.stubGlobal('AbortController', NativeAbortController);
        vi.useFakeTimers();
        const entered = createDeferred<void>();
        let heldSignal: AbortSignal | null | undefined;
        let release: (() => void) | undefined;
        setRuntimeFetch(async (url, init) => {
            if (new URL(String(url)).pathname !== '/v1/kv/bulk') return Response.json({ ok: true });
            heldSignal = init?.signal;
            entered.resolve();
            if (phase === 'headers') return await new Promise<Response>((resolve, reject) => {
                release = () => resolve(Response.json({ values: [] }));
                init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
            return new Response(new ReadableStream<Uint8Array>({ start(controller) {
                let closed = false;
                release = () => { if (!closed) { closed = true; controller.enqueue(new TextEncoder().encode('{"values":[]}')); controller.close(); } };
                init?.signal?.addEventListener('abort', () => { if (!closed) { closed = true; controller.error(new DOMException('Aborted', 'AbortError')); } }, { once: true });
            } }));
        });
        let settled = false;
        const pending = kvBulkGet({ token: 'kv-synthetic-token' }, ['todo.retry'])
            .then(() => null, (error: unknown) => error).finally(() => { settled = true; });
        try {
            await entered.promise;
            abortServerFetches('manual-retry', { readOnly: true });
            await vi.advanceTimersByTimeAsync(0);
            expect(heldSignal?.aborted).toBe(true);
            expect(settled).toBe(true);
            expect(await pending).toMatchObject({ name: 'ServerFetchReadSupersededError' });
            expect(vi.getTimerCount()).toBe(0);
        } finally { release?.(); await pending; }
    });

    it.each(['active', 'explicit'] as const)('retains cancellation through a returned %s response body', async kind => {
        const endpoint = `https://${kind}-body.example.test`;
        await upsertAndActivateServer({ serverUrl: endpoint });
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_SERVER_READ_INACTIVITY_TIMEOUT_MS', '50');
        vi.useFakeTimers();
        let heldSignal: AbortSignal | undefined | null;
        const entered = createDeferred<void>();
        const request = kind === 'active' ? serverFetch : createServerFetchAtEndpoint({ endpointUrl: endpoint, credentials: null });
        let release: (() => void) | undefined;
        setRuntimeFetch(async (_url, init) => {
            heldSignal = init?.signal;
            entered.resolve();
            return new Response(new ReadableStream<Uint8Array>({ start(controller) {
                release = () => controller.error(new DOMException('Aborted', 'AbortError'));
                init?.signal?.addEventListener('abort', release, { once: true });
            } }));
        });
        let settled = false;
        const pending = request('/v2/changes', undefined, { includeAuth: false, retry: 'none', recoveryRead: 'paged' })
            .then(response => response.json()).then(() => null, (error: unknown) => error).finally(() => { settled = true; });
        try {
            await entered.promise;
            await vi.advanceTimersByTimeAsync(51);
            expect(settled).toBe(true);
            expect(heldSignal?.aborted).toBe(true);
            const error = await pending;
            expect(error).toMatchObject({ name: 'ServerFetchReadTimeoutError' });
            expect(isTransientConnectivityError(error)).toBe(true);
        } finally { release?.(); await pending; }
    });

    it.each(['paged', 'unbounded'] as const)('keeps native %s reads recoverable without imposing a deadline on large unpaged transfers', async recoveryRead => {
        platform.OS = 'android';
        vi.stubGlobal('AbortController', NativeAbortController);
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_SERVER_READ_INACTIVITY_TIMEOUT_MS', '50');
        vi.useFakeTimers();
        const entered = createDeferred<void>();
        const transfer = createDeferred<Response>();
        setRuntimeFetch(async (_url, init) => {
            init?.signal?.addEventListener('abort', () => transfer.reject(new DOMException('Aborted', 'AbortError')), { once: true });
            entered.resolve();
            return transfer.promise;
        });
        let settled = false;
        const request = createServerFetchAtEndpoint({ endpointUrl: 'https://native-read.example.test', credentials: null });
        const pending = request('/read', undefined, { recoveryRead, retry: 'none' })
            .then(response => ({ response }), (error: unknown) => ({ error })).finally(() => { settled = true; });
        try {
            await entered.promise;
            await vi.advanceTimersByTimeAsync(51);
            expect(settled).toBe(recoveryRead === 'paged');
            transfer.resolve(Response.json({ ok: true }));
            expect(await pending).toMatchObject(recoveryRead === 'paged'
                ? { error: { name: 'ServerFetchReadTimeoutError' } } : { response: { ok: true } });
        } finally { transfer.resolve(Response.json({ ok: true })); await pending; }
    });

    it('allows a progressing web body to exceed the inactivity window', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_SERVER_READ_INACTIVITY_TIMEOUT_MS', '50');
        vi.useFakeTimers();
        let body!: ReadableStreamDefaultController<Uint8Array>;
        setRuntimeFetch(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } })));
        const request = createServerFetchAtEndpoint({ endpointUrl: 'https://progress.example.test', credentials: null });
        const pending = request('/read', undefined, { retry: 'none' }, response => response.json());
        await vi.advanceTimersByTimeAsync(0);
        for (const chunk of ['{"value":', '"slow', ' but progressing"}']) {
            await vi.advanceTimersByTimeAsync(40);
            body.enqueue(new TextEncoder().encode(chunk));
            await vi.advanceTimersByTimeAsync(0);
        }
        body.close();
        await expect(pending).resolves.toEqual({ value: 'slow but progressing' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('manual recovery cancels GET and POST reads with native abort causes while preserving mutations', async () => {
        platform.OS = 'android';
        vi.stubGlobal('AbortController', NativeAbortController);
        const request = createServerFetchAtEndpoint({ endpointUrl: 'https://retry-read.example.test', credentials: null });
        const signals: AbortSignal[] = [];
        const releases: Array<() => void> = [];
        setRuntimeFetch(async (_url, init) => {
            signals.push(init!.signal!);
            return new Promise<Response>((resolve, reject) => {
                init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
                releases.push(() => resolve(Response.json({ ok: true })));
            });
        });
        const reads = ['GET', 'POST'].map(method => request('/read', { method }, { retry: 'none', recoveryRead: 'unbounded' })
            .then(() => null, (error: unknown) => error));
        const write = request('/write', { method: 'POST' }, { retry: 'none' });
        try {
            await vi.waitFor(() => expect(releases).toHaveLength(3));
            abortServerFetches('manual-retry', { readOnly: true });
            expect(signals.map(signal => signal.aborted)).toEqual([true, true, false]);
            expect(await Promise.all(reads)).toEqual([
                expect.objectContaining({ name: 'ServerFetchReadSupersededError' }),
                expect.objectContaining({ name: 'ServerFetchReadSupersededError' }),
            ]);
        } finally { releases.forEach(release => release()); await Promise.all([...reads, write]); }
    });
});
