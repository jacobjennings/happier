import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    isBrowserIrohHost,
    resolveBrowserIrohHostDecision,
    type BrowserIrohHostCapabilities,
} from './hostEligibility';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeWebMock();
});

const BROWSER: BrowserIrohHostCapabilities = { hasSharedWorker: true };

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';

const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
    + ' Chrome/150.0.0.0 Safari/537.36';

function setUserAgent(userAgent: string) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { userAgent },
    });
}

afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as Record<string, unknown>)[TAURI_INTERNALS_KEY];
    Reflect.deleteProperty(globalThis, 'navigator');
    Reflect.deleteProperty(globalThis, 'SharedWorker');
    Reflect.deleteProperty(globalThis, 'indexedDB');
});

describe('sync/runtime/browserIroh/hostEligibility', () => {
    it('accepts a pure browser web runtime', () => {
        setUserAgent(BROWSER_USER_AGENT);
        expect(resolveBrowserIrohHostDecision(BROWSER)).toEqual({ eligible: true });
        expect(isBrowserIrohHost(BROWSER)).toBe(true);
    });

    it('excludes a Tauri desktop host that runs the same web bundle', () => {
        setUserAgent(BROWSER_USER_AGENT);
        (globalThis as Record<string, unknown>)[TAURI_INTERNALS_KEY] = { invoke: () => null };

        expect(resolveBrowserIrohHostDecision(BROWSER)).toEqual({
            eligible: false,
            reason: 'desktop_host',
        });
    });

    it('reports the missing capability rather than falling back to a per-tab endpoint', () => {
        setUserAgent(BROWSER_USER_AGENT);

        expect(resolveBrowserIrohHostDecision({ hasSharedWorker: false })).toEqual({
            eligible: false,
            reason: 'shared_worker_unsupported',
        });
    });

    it('accepts a browser with no device-local storage at all', () => {
        // Lane 06 amendment A10: the endpoint identity is ephemeral and lives
        // only in the live SharedWorker global, so nothing about the carrier
        // needs IndexedDB. A private-mode or storage-restricted browser that
        // can host the worker is eligible; requiring a store the carrier never
        // opens would refuse a host that works.
        setUserAgent(BROWSER_USER_AGENT);
        Object.defineProperty(globalThis, 'SharedWorker', { configurable: true, value: function SharedWorkerStub() {} });
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });

        expect(resolveBrowserIrohHostDecision()).toEqual({ eligible: true });
    });
});
