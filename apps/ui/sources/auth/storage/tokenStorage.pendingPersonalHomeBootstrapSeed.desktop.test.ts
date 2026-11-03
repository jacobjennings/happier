import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageTestIsolation, installTokenStorageWebPlatformMocks } from './tokenStorage.testHelpers';
import { installLocalStorageMock } from './tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();
installTokenStorageTestIsolation('token_storage_seed_desktop');

const desktop = vi.hoisted(() => ({
    kind: 'tauri' as 'tauri' | 'electron',
    values: new Map<string, string>(),
    calls: [] as Array<Readonly<{ command: string; args?: Record<string, unknown> }>>,
}));

vi.mock('@/utils/platform/desktopHost', () => ({
    desktopHostKind: () => desktop.kind,
    invokeDesktopHost: async (command: string, args?: Record<string, unknown>) => {
        desktop.calls.push({ command, ...(args ? { args } : {}) });
        const key = String(args?.key ?? '');
        if (command === 'desktop_secure_storage_read') return desktop.values.get(key) ?? null;
        if (command === 'desktop_secure_storage_write') {
            desktop.values.set(key, String(args?.value ?? ''));
            return null;
        }
        if (command === 'desktop_secure_storage_remove') {
            desktop.values.delete(key);
            return null;
        }
        throw new Error(`Unexpected Desktop command: ${command}`);
    },
}));

// desktopHostKind() is read per storage call, so one module instance serves both host rows.
const { TokenStorage } = await import('./tokenStorage');

const HOME_URL = 'http://127.0.0.1:43123';
const HOME_IDENTITY = 'srv_personal_home';

describe.each(['tauri', 'electron'] as const)('%s pending Personal Home seed custody', (kind) => {
    let restoreLocalStorage: (() => void) | null = null;

    beforeEach(() => {
        desktop.kind = kind;
        desktop.values.clear();
        desktop.calls.length = 0;
    });

    afterEach(() => {
        restoreLocalStorage?.();
        restoreLocalStorage = null;
    });

    it('writes, reads, and removes only through Desktop secure storage', async () => {
        const localStorage = installLocalStorageMock();
        restoreLocalStorage = localStorage.restore;
        const seed = new Uint8Array(32).fill(7);
        const target = { serverId: HOME_IDENTITY };

        await expect(TokenStorage.setPendingPersonalHomeBootstrapSeed(HOME_URL, target, seed)).resolves.toBe(true);
        await expect(TokenStorage.getPendingPersonalHomeBootstrapSeed(HOME_URL, target)).resolves.toEqual(seed);
        expect([...localStorage.store.keys()].filter((key) => key.includes('pending_personal_home_bootstrap_seed'))).toEqual([]);
        expect(desktop.calls.some((call) => call.command === 'desktop_secure_storage_write')).toBe(true);

        await expect(TokenStorage.clearPendingPersonalHomeBootstrapSeed(HOME_URL, target)).resolves.toBe(true);
        expect(desktop.calls.some((call) => call.command === 'desktop_secure_storage_remove')).toBe(true);
        expect(desktop.values.size).toBe(0);
    });
});
