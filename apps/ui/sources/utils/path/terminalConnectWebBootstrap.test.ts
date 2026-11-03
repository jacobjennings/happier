import { describe, expect, it, vi } from 'vitest';

import {
    TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY,
    bootstrapTerminalConnectWebHash,
    consumeTerminalConnectWebBootstrapHash,
} from './terminalConnectWebBootstrap';

function createMemorySessionStorage(): Storage {
    const map = new Map<string, string>();
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
            map.set(key, String(value));
        },
        removeItem: (key: string) => {
            map.delete(key);
        },
        clear: () => {
            map.clear();
        },
        key: (index: number) => Array.from(map.keys())[index] ?? null,
        get length() {
            return map.size;
        },
    } as unknown as Storage;
}

describe('terminalConnectWebBootstrap', () => {
    it('stores the terminal-connect hash and removes it from the visible URL', () => {
        const sessionStorage = createMemorySessionStorage();
        const history = { replaceState: vi.fn() } as unknown as History;
        const url = new URL('https://web.happier.dev/terminal/connect#key=abcDEF_123-zzz&server=https%3A%2F%2Fstack.example.test');

        bootstrapTerminalConnectWebHash({ url, sessionStorage, history });

        expect(sessionStorage.getItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY)).toBe(url.hash);
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/terminal/connect');
    });

    it('takes custody of a descriptor (v4) terminal-connect hash the same way', () => {
        const sessionStorage = createMemorySessionStorage();
        const history = { replaceState: vi.fn() } as unknown as History;
        const url = new URL('https://web.happier.dev/terminal/connect#v4=eyJ2Ijo0fQ');

        bootstrapTerminalConnectWebHash({ url, sessionStorage, history });

        expect(sessionStorage.getItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY)).toBe(url.hash);
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/terminal/connect');
    });

    it('keeps the hash visible when session storage cannot take custody', () => {
        const sessionStorage = createMemorySessionStorage();
        vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage denied'); });
        const history = { replaceState: vi.fn() } as unknown as History;
        const url = new URL('https://web.happier.dev/terminal/connect#key=abcDEF_123-zzz');

        bootstrapTerminalConnectWebHash({ url, sessionStorage, history });

        expect(history.replaceState).not.toHaveBeenCalled();
    });

    it('invalidates the stored copy when visible-URL scrubbing fails', () => {
        const sessionStorage = createMemorySessionStorage();
        const history = {
            replaceState: vi.fn(() => { throw new Error('history denied'); }),
        } as unknown as History;
        const url = new URL('https://web.happier.dev/terminal/connect#key=abcDEF_123-zzz');

        bootstrapTerminalConnectWebHash({ url, sessionStorage, history });

        expect(consumeTerminalConnectWebBootstrapHash(sessionStorage)).toBeNull();
    });

    it('does nothing when the URL is not a terminal-connect link', () => {
        const sessionStorage = createMemorySessionStorage();
        const history = { replaceState: vi.fn() } as unknown as History;

        bootstrapTerminalConnectWebHash({
            url: new URL('https://web.happier.dev/'),
            sessionStorage,
            history,
        });

        expect(sessionStorage.getItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY)).toBeNull();
        expect(history.replaceState).not.toHaveBeenCalled();
    });

    it('consumes and clears the stored hash', () => {
        const sessionStorage = createMemorySessionStorage();
        sessionStorage.setItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY, '#key=abcDEF_123-zzz');

        expect(consumeTerminalConnectWebBootstrapHash(sessionStorage)).toBe('#key=abcDEF_123-zzz');
        expect(sessionStorage.getItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY)).toBeNull();
    });

    it('returns a captured hash even when best-effort removal fails', () => {
        const sessionStorage = createMemorySessionStorage();
        sessionStorage.setItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY, '#key=abcDEF_123-zzz');
        vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('storage denied'); });

        expect(consumeTerminalConnectWebBootstrapHash(sessionStorage)).toBe('#key=abcDEF_123-zzz');
        expect(consumeTerminalConnectWebBootstrapHash(sessionStorage)).toBeNull();
    });
});
