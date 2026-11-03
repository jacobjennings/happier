import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedPersistedHomeProfilesForTests } from '@/dev/testkit/fixtures/persistedHomeProfiles';
import { homeProfileForTests } from '@/auth/storage/tokenStorage.testHelpers';

import { getActiveServerSnapshot } from './serverProfiles';
import { focusExactHomeAndRefresh } from './focusExactHome';

// A saved Home without a stable identity is addressed by its profile id, so the
// real switch owner reports it as already active without a connection change.
const HOME = homeProfileForTests('home-a', 'https://home-a.test');

describe('focusExactHomeAndRefresh', () => {
    beforeEach(async () => {
        await seedPersistedHomeProfilesForTests({ profiles: [HOME], activeServerId: HOME.id });
    });

    it('reports an already-active refresh rejection as a blocked arrival', async () => {
        const refreshAuth = vi.fn().mockRejectedValue(new Error('refresh failed'));

        await expect(focusExactHomeAndRefresh({
            serverId: HOME.id,
            refreshAuth,
        })).resolves.toBe(false);

        expect(refreshAuth).toHaveBeenCalledTimes(1);
        expect(getActiveServerSnapshot().serverId).toBe(HOME.id);
    });

    it('refreshes the committed credential when the exact Home is already focused', async () => {
        const refreshAuth = vi.fn(async () => {});

        await expect(focusExactHomeAndRefresh({
            serverId: HOME.id,
            refreshAuth,
        })).resolves.toBe(true);

        expect(refreshAuth).toHaveBeenCalledTimes(1);
        expect(getActiveServerSnapshot().serverId).toBe(HOME.id);
    });

    it('reports a Home this device has not saved as a failed arrival without refreshing', async () => {
        const refreshAuth = vi.fn(async () => {});

        await expect(focusExactHomeAndRefresh({
            serverId: 'unsaved-home',
            refreshAuth,
        })).resolves.toBe(false);

        expect(refreshAuth).not.toHaveBeenCalled();
        expect(getActiveServerSnapshot().serverId).toBe(HOME.id);
    });
});
