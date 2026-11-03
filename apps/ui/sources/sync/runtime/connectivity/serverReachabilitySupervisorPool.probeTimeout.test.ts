import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';

import {
    resetServerReachabilitySupervisors,
    startServerReachabilitySupervisor,
    subscribeServerReachabilityState,
    waitForServerReachable,
} from './serverReachabilitySupervisorPool';

function delayedResponse(params: Readonly<{ ms: number; response: Response; signal?: AbortSignal }>): Promise<Response> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve(params.response), Math.max(0, params.ms));
        const cleanup = () => {
            clearTimeout(timeout);
            params.signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(new Error('Aborted'));
        };
        if (params.signal) {
            if (params.signal.aborted) {
                onAbort();
                return;
            }
            params.signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

describe('serverReachabilitySupervisorPool (slow successful probes)', () => {
    const previousProbeTimeout = process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_PROBE_TIMEOUT_MS;

    beforeEach(() => {
        vi.useFakeTimers();
        process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_PROBE_TIMEOUT_MS = '50';
    });

    afterEach(async () => {
        if (previousProbeTimeout === undefined) delete process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_PROBE_TIMEOUT_MS;
        else process.env.EXPO_PUBLIC_HAPPIER_SERVER_REACHABILITY_PROBE_TIMEOUT_MS = previousProbeTimeout;
        resetRuntimeFetch();
        await resetServerReachabilitySupervisors();
        vi.useRealTimers();
    });

    it.each([
        { name: 'tokenless /health', token: null, slowPath: '/health', fastPath: null },
        { name: 'authenticated /v1/auth/ping', token: 'token', slowPath: '/v1/auth/ping', fastPath: '/health' },
    ])('keeps a slow $name probe pending until the Home answers', async ({ token, slowPath, fastPath }) => {
        const okJson = () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        setRuntimeFetch((input, init) => {
            const url = String(input);
            if (url.endsWith(slowPath)) {
                return delayedResponse({ ms: 20_000, response: okJson(), signal: init?.signal ?? undefined });
            }
            if (fastPath && url.endsWith(fastPath)) return Promise.resolve(okJson());
            throw new Error(`Unexpected probe URL: ${url}`);
        });

        let lastPhase: string | null = null;
        const unsubscribe = subscribeServerReachabilityState('https://example.test', (state) => {
            lastPhase = state.phase;
        }, token ?? undefined);

        const startPromise = startServerReachabilitySupervisor({ serverUrl: 'https://example.test', token });
        let reachable = false;
        const wait = waitForServerReachable({ serverUrl: 'https://example.test', token })
            .then(() => { reachable = true; });
        void wait.catch(() => {});

        try {
            await vi.advanceTimersByTimeAsync(16_000);
            // The generic supervisor stays idle while its initial readiness
            // probe is pending; neither idle nor connecting is an outage.
            expect(['idle', 'connecting']).toContain(lastPhase);
            expect(reachable).toBe(false);
        } finally {
            await vi.advanceTimersByTimeAsync(4_000);
            await startPromise.catch(() => {});
            unsubscribe();
        }

        await wait;
        expect(lastPhase).toBe('online');
    });
});
