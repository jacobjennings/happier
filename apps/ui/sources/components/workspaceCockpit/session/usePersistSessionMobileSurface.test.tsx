import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';
import { activatePendingQueueScope } from '@/sync/engine/pending/pendingQueueV2.testHelpers';
import { storage, useSessionLastMobileSurface } from '@/sync/domains/state/storage';

import type { SessionMobileSurface } from './sessionCockpitState';
import { usePersistSessionMobileSurface } from './usePersistSessionMobileSurface';

type Props = Readonly<{ surface: SessionMobileSurface | null; serverId?: string | null; enabled?: boolean }>;

beforeEach(async () => {
    await loadSyncSingletonForTests();
    storage.setState(storage.getInitialState(), true);
    await activatePendingQueueScope({ serverId: 'active-server', accountId: 'account-a' });
});

afterEach(() => {
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
});

describe('usePersistSessionMobileSurface', () => {
    it('persists the shown surface for the exact Home and skips disabled or empty surfaces', async () => {
        const hook = await renderHook((props: Props) => {
            usePersistSessionMobileSurface({ sessionId: 'session-1', ...props });
            return useSessionLastMobileSurface('session-1', 'active-server');
        }, { initialProps: { surface: 'git', serverId: 'active-server' } });
        expect(hook.getCurrent()).toBe('git');

        // An unlisted Session binds its Account realm only through the forwarded exact Home.
        expect(await hook.rerender({ surface: 'browse' })).toBe('git');
        expect(await hook.rerender({ surface: 'terminal', serverId: 'active-server', enabled: false })).toBe('git');
        expect(await hook.rerender({ surface: null, serverId: 'active-server' })).toBe('git');
        expect(await hook.rerender({ surface: 'browse', serverId: 'active-server' })).toBe('browse');
        await hook.unmount();
    });
});
