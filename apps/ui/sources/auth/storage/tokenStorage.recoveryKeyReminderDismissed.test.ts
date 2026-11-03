import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorageMock } from './tokenStorage.web.testHelpers';
import { installTokenStorageTestIsolation, installTokenStorageWebPlatformMocks } from './tokenStorage.testHelpers';

installTokenStorageWebPlatformMocks();
installTokenStorageTestIsolation('token_storage_recovery_reminder');

const { TokenStorage } = await import('./tokenStorage');

describe('TokenStorage recovery key reminder dismissed (web)', () => {
    let restoreLocalStorage: (() => void) | null = null;

    beforeEach(() => {
        restoreLocalStorage = installLocalStorageMock().restore;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreLocalStorage?.();
        restoreLocalStorage = null;
    });

    it('round-trips dismissed state', async () => {
        await expect(TokenStorage.getRecoveryKeyReminderDismissed()).resolves.toBe(false);

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(true)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderDismissed()).resolves.toBe(true);

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(false)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderDismissed()).resolves.toBe(false);
    });

    it('exposes the dismissed state through the synchronous cache path on web', async () => {
        expect(TokenStorage.getCachedRecoveryKeyReminderDismissed()).toBe(false);

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(true)).resolves.toBe(true);
        expect(TokenStorage.getCachedRecoveryKeyReminderDismissed()).toBe(true);

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(false)).resolves.toBe(true);
        expect(TokenStorage.getCachedRecoveryKeyReminderDismissed()).toBe(false);
    });

    it('updates the captured Home reminder without mutating the active Home scope', async () => {
        const homeA = { serverUrl: 'https://home-a.example.test', serverId: 'home-a' };
        const homeB = { serverUrl: 'https://home-b.example.test', serverId: 'home-b' };

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(true, homeA)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderDismissed(homeA)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderDismissed(homeB)).resolves.toBe(false);

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(true, homeB)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderDismissed(homeA)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderDismissed(homeB)).resolves.toBe(true);
    });

    it('keeps an account service reminder apart from every Home reminder, and pending only when recorded', async () => {
        // A dual-role server: the account service and the Home share one server identity.
        const home = { serverUrl: 'https://accounts.example.test', serverId: 'srv_same' };
        const service = { kind: 'account_service' as const, serverIdentityId: 'srv_same' };
        const otherService = { kind: 'account_service' as const, serverIdentityId: 'srv_other' };

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(true, home)).resolves.toBe(true);
        // No reminder exists for a service until one is recorded.
        await expect(TokenStorage.getRecoveryKeyReminderPending(service)).resolves.toBe(false);

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(false, service)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderPending(service)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderPending(otherService)).resolves.toBe(false);
        // The Home reminder is untouched by the service's.
        await expect(TokenStorage.getRecoveryKeyReminderDismissed(home)).resolves.toBe(true);

        await expect(TokenStorage.setRecoveryKeyReminderDismissed(true, service)).resolves.toBe(true);
        await expect(TokenStorage.getRecoveryKeyReminderPending(service)).resolves.toBe(false);
        await expect(TokenStorage.getRecoveryKeyReminderDismissed(home)).resolves.toBe(true);
    });
});
