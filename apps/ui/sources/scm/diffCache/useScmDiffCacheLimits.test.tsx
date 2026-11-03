import { afterEach, describe, expect, it } from 'vitest';

import { act, renderHook } from '@/dev/testkit';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { storage } from '@/sync/domains/state/storage';

import { ScmDiffCache } from './scmDiffCache';
import { useScmDiffCacheLimits } from './useScmDiffCacheLimits';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = (path: string) => ({ sessionId: 's1', snapshotSignature: 'sig', diffArea: 'pending', path }) as const;

function setAccountDiffCacheLimits(scmDiffCacheMaxEntries: number, scmDiffCacheMaxTotalBytes: number) {
    storage.setState({ settings: { ...(storage.getState().settings ?? settingsDefaults), scmDiffCacheMaxEntries, scmDiffCacheMaxTotalBytes } });
}

describe('useScmDiffCacheLimits', () => {
    const initialState = storage.getState();
    afterEach(() => {
        storage.setState(initialState, true);
    });

    it('bounds the diff cache by the Account settings and follows their changes', async () => {
        setAccountDiffCacheLimits(2, 10_000);
        const cache = new ScmDiffCache({ maxEntries: 10, maxTotalBytes: 10_000, now: () => 1 });
        for (const path of ['a.ts', 'b.ts', 'c.ts']) cache.set(key(path), path);

        await renderHook(() => useScmDiffCacheLimits(cache));
        expect(cache.get(key('a.ts'))).toBeNull();
        expect(cache.get(key('b.ts'))?.diff).toBe('b.ts');
        expect(cache.get(key('c.ts'))?.diff).toBe('c.ts');

        // A lower byte budget evicts down to the newest entry that still fits.
        await act(async () => {
            setAccountDiffCacheLimits(2, 'c.ts'.length * 2);
        });
        expect(cache.get(key('b.ts'))).toBeNull();
        expect(cache.get(key('c.ts'))?.diff).toBe('c.ts');
    });
});
