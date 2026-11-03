import * as React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer';

import {
    buildDynamicSectionCacheKey,
    createDefaultDynamicSectionCache,
    getDefaultDynamicSectionCache,
    type SelectionListDynamicSectionCache,
} from '../selectionListDynamicSectionCache';
import { useSelectionListDynamicSections } from '../useSelectionListDynamicSections';
import type { SelectionListDynamicSection } from '../_types';

/**
 * FR4-12 — explicit cache adapter for cross-mount dynamic section caching.
 *
 * The adapter replaces the implicit module-level LRU global. Callers can pass
 * an isolated instance to keep rows out of the process cache; production code
 * without an injected cache falls back to the singleton.
 */

/** The production cache cap: the process cache holds at most this many seeds. */
const DEFAULT_CAP = 64;

function fill(cache: SelectionListDynamicSectionCache, count: number): void {
    for (let i = 0; i < count; i += 1) {
        cache.set(`k${i}`, [{ id: `v${i}`, label: '' }]);
    }
}

describe('selectionListDynamicSectionCache adapter', () => {
    describe('createDefaultDynamicSectionCache', () => {
        it('promotes entries to MRU on get (LRU semantics)', () => {
            const cache = createDefaultDynamicSectionCache();
            fill(cache, DEFAULT_CAP);
            // Promote the oldest entry; k1 becomes the LRU end.
            void cache.get('k0');
            cache.set('overflow', [{ id: 'overflow', label: '' }]);
            expect(cache.get('k0')).toBeDefined();
            expect(cache.get('k1')).toBeUndefined();
            expect(cache.get('k2')).toBeDefined();
            expect(cache.get('overflow')).toBeDefined();
        });

        it('evicts the oldest entry once the default 64-entry cap is exceeded', () => {
            const cache = createDefaultDynamicSectionCache();
            fill(cache, DEFAULT_CAP + 1);
            expect(cache.size()).toBe(DEFAULT_CAP);
            expect(cache.get('k0')).toBeUndefined();
            expect(cache.get('k1')).toBeDefined();
            expect(cache.get(`k${DEFAULT_CAP}`)).toBeDefined();
        });

        it('delete removes a single entry without affecting others', () => {
            const cache = createDefaultDynamicSectionCache();
            cache.set('k1', [{ id: '1', label: '1' }]);
            cache.set('k2', [{ id: '2', label: '2' }]);
            cache.delete('k1');
            expect(cache.get('k1')).toBeUndefined();
            expect(cache.get('k2')).toBeDefined();
            expect(cache.size()).toBe(1);
        });

        it('overwriting an existing key promotes it to MRU and updates value', () => {
            const cache = createDefaultDynamicSectionCache();
            fill(cache, DEFAULT_CAP);
            // Re-set the oldest key with a new value; it should become MRU.
            cache.set('k0', [{ id: 'v0-updated', label: '' }]);
            // Insert one more — the LRU end is now k1, so k1 evicts.
            cache.set('overflow', [{ id: 'overflow', label: '' }]);
            expect(cache.get('k0')?.[0]?.id).toBe('v0-updated');
            expect(cache.get('k1')).toBeUndefined();
            expect(cache.get('overflow')).toBeDefined();
        });

        it('returns an isolated instance per call with no shared state', () => {
            const a = createDefaultDynamicSectionCache();
            const b = createDefaultDynamicSectionCache();
            a.set('k', [{ id: 'a', label: '' }]);
            expect(b.get('k')).toBeUndefined();
        });
    });

    describe('buildDynamicSectionCacheKey', () => {
        it('cannot collide when tuple fields contain the legacy delimiter', () => {
            const left = buildDynamicSectionCacheKey('provider::target', 'generation', 'query');
            const right = buildDynamicSectionCacheKey('provider', 'target::generation', 'query');

            expect(left).not.toBe(right);
        });
    });
});

// ─── Hook integration via injection ──────────────────────────────────────────

type Capture = ReturnType<typeof useSelectionListDynamicSections>;

function HostHarness(props: {
    dynamicSections: ReadonlyArray<SelectionListDynamicSection>;
    inputValue: string;
    cache?: SelectionListDynamicSectionCache;
    onState: (state: Capture) => void;
}): null {
    const state = useSelectionListDynamicSections({
        dynamicSections: props.dynamicSections,
        inputValue: props.inputValue,
        cache: props.cache,
    });
    React.useEffect(() => {
        props.onState(state);
    });
    return null;
}

let renderer: ReactTestRenderer | null = null;
let onState: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    onState = vi.fn();
});

afterEach(() => {
    if (renderer) {
        act(() => {
            renderer!.unmount();
        });
        renderer = null;
    }
    vi.useRealTimers();
});

describe('useSelectionListDynamicSections — cache injection (FR4-12)', () => {
    it('writes successful resolves to the injected cache (not the singleton)', async () => {
        const injected = createDefaultDynamicSectionCache();
        const singleton = getDefaultDynamicSectionCache();
        const resolver = vi.fn(async () => ({
            options: [{ id: 'a', label: 'Apple' }],
        }));
        const section: SelectionListDynamicSection = {
            id: 'in-this-folder',
            resolverKey: 'machine:m1',
            resolve: resolver,
            debounceMs: 0,
        };
        await act(async () => {
            renderer = createRenderer(
                <HostHarness
                    dynamicSections={[section]}
                    inputValue="~/Documents/"
                    cache={injected}
                    onState={onState}
                />,
            );
        });
        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
            await Promise.resolve();
        });

        const cacheKey = buildDynamicSectionCacheKey('in-this-folder', 'machine:m1', '~/Documents/');
        expect(injected.get(cacheKey)?.map((o) => o.id)).toEqual(['a']);
        // Singleton was NOT written.
        expect(singleton.get(cacheKey)).toBeUndefined();
    });
});
