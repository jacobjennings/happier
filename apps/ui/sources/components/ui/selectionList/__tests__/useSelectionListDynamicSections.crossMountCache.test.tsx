import * as React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer';

import { useSelectionListDynamicSections } from '../useSelectionListDynamicSections';
import {
    createDefaultDynamicSectionCache,
    type SelectionListDynamicSectionCache,
} from '../selectionListDynamicSectionCache';
import type {
    SelectionListDynamicSection,
} from '../_types';

/**
 * RUX-11.1 — cross-mount cache for dynamic sections.
 *
 * Symptom: opening the path popover always flickered through an empty "In
 * this folder" section before results arrived, even when reopening
 * IMMEDIATELY after closing. Per-mount state means the freshly-mounted hook
 * loses the prior options on every open.
 *
 * Fix: a module-level LRU cache keyed by the canonical JSON identity tuple
 * stores the last successful options. On mount the reducer's initial state
 * seeds `lastSuccessOptions` from the cache when present. On every
 * successful resolve the cache is updated. Aborted in-flight resolves do
 * NOT poison the cache (only a successful response writes).
 *
 * Isolation: every test injects its own `createDefaultDynamicSectionCache()`
 * except the default-path round trip, which uses a section id no other test
 * in this file shares.
 */

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
let cache: SelectionListDynamicSectionCache;

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    onState = vi.fn();
    cache = createDefaultDynamicSectionCache();
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

function lastState(): Capture {
    expect(onState).toHaveBeenCalled();
    return onState.mock.calls[onState.mock.calls.length - 1]![0] as Capture;
}

describe('useSelectionListDynamicSections — cross-mount cache (RUX-11.1)', () => {
    it('keeps progress uncached and drops publication from a retired request', async () => {
        const publications: Array<NonNullable<Parameters<SelectionListDynamicSection['resolve']>[2]>> = [];
        const completions: Array<(result: Awaited<ReturnType<SelectionListDynamicSection['resolve']>>) => void> = [];
        const section: SelectionListDynamicSection = {
            id: 'progress', resolverKey: 'exact-account', debounceMs: 0,
            resolve: async (_query, _signal, publish) => {
                if (publish) publications.push(publish);
                return new Promise(resolve => { completions.push(resolve); });
            },
        };
        await act(async () => {
            renderer = createRenderer(<HostHarness dynamicSections={[section]} inputValue="old" cache={cache} onState={onState} />);
        });
        await act(async () => { publications[0]!({ options: [{ id: 'partial', label: 'Current match' }] }); });
        expect(lastState().get('progress')).toMatchObject({ status: 'loading', options: [{ id: 'partial' }] });
        expect(cache.size()).toBe(0);
        await act(async () => {
            renderer!.update(<HostHarness dynamicSections={[section]} inputValue="new" cache={cache} onState={onState} />);
        });
        await act(async () => {
            publications[0]!({ options: [{ id: 'late', label: 'Retired match' }] });
            completions[0]!({ options: [{ id: 'old-final', label: 'Retired final' }] });
        });
        expect(lastState().get('progress')?.options).not.toContainEqual(expect.objectContaining({ id: 'late' }));
        expect(cache.size()).toBe(0);
        await act(async () => { completions[1]!({ options: [{ id: 'final', label: 'Final match' }] }); });
        await act(async () => { publications[1]!({ options: [{ id: 'after-final', label: 'Late progress' }] }); });
        expect(lastState().get('progress')).toMatchObject({ status: 'success', options: [{ id: 'final' }] });
        expect(cache.size()).toBe(1);
    });
    it('seeds the new mount with the last-successful options after unmount + remount with the same id+resolverKey+seed', async () => {
        const resolver = vi.fn(async () => ({
            options: [{ id: 'a', label: 'Apple' }],
        }));
        // No injected cache: this round trip goes through the process-wide
        // default cache, under a section id unique to this test.
        const section: SelectionListDynamicSection = {
            id: 'default-cache-round-trip',
            resolverKey: 'machine:m1',
            resolve: resolver,
            debounceMs: 0,
        };
        // First mount, fetch + success.
        await act(async () => {
            renderer = createRenderer(
                <HostHarness dynamicSections={[section]} inputValue="~/Documents/" onState={onState} />,
            );
        });
        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
            await Promise.resolve();
        });
        const firstSuccess = lastState().get('default-cache-round-trip');
        expect(firstSuccess?.status).toBe('success');
        expect(firstSuccess?.options.map((o) => o.id)).toEqual(['a']);

        // Unmount.
        await act(async () => {
            renderer!.unmount();
            renderer = null;
        });

        // Remount IMMEDIATELY with the same descriptor + same input. The
        // hook's initial state for this section must seed
        // `lastSuccessOptions` from the cross-mount cache so the orchestrator
        // does not flicker through an empty list before the new fetch lands.
        onState = vi.fn();
        await act(async () => {
            renderer = createRenderer(
                <HostHarness dynamicSections={[section]} inputValue="~/Documents/" onState={onState} />,
            );
        });
        // BEFORE advancing timers (i.e. before the new fetch dispatches), the
        // hook should already expose the cached options. This is the whole
        // point of the cross-mount cache: there is NO empty-then-loading
        // intermediate state.
        const initial = lastState().get('default-cache-round-trip');
        expect(initial?.lastSuccessOptions?.map((o) => o.id)).toEqual(['a']);
    });

    it('does not seed the new mount when the cache key differs (different resolverKey)', async () => {
        const resolverM1 = vi.fn(async () => ({
            options: [{ id: 'a', label: 'Apple' }],
        }));
        const sectionM1: SelectionListDynamicSection = {
            id: 'in-this-folder',
            resolverKey: 'machine:m1',
            resolve: resolverM1,
            debounceMs: 0,
        };
        // Populate cache for m1.
        await act(async () => {
            renderer = createRenderer(
                <HostHarness dynamicSections={[sectionM1]} inputValue="~/" cache={cache} onState={onState} />,
            );
        });
        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.unmount();
            renderer = null;
        });

        // Remount with a DIFFERENT resolverKey AND a never-resolving
        // resolver so the post-mount loading state preserves whatever the
        // cross-mount cache seeded into the initial state. If the cache
        // miss is correctly applied for the new key, initial
        // lastSuccessOptions is undefined and the loading entry's
        // lastSuccessOptions stays undefined too.
        const sectionM2: SelectionListDynamicSection = {
            id: 'in-this-folder',
            resolverKey: 'machine:m2',
            resolve: () => new Promise(() => {}),
            debounceMs: 0,
        };
        onState = vi.fn();
        await act(async () => {
            renderer = createRenderer(
                <HostHarness dynamicSections={[sectionM2]} inputValue="~/" cache={cache} onState={onState} />,
            );
        });
        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        const initial = lastState().get('in-this-folder');
        // Loading state from never-resolving resolver. The cache MISSED for
        // m2, so lastSuccessOptions remains undefined despite m1 having
        // populated the cache before unmount.
        expect(initial?.status).toBe('loading');
        expect(initial?.lastSuccessOptions).toBeUndefined();
    });

    it('does NOT poison the cache when the resolve is aborted before completion (abort-safe)', async () => {
        let resolveDeferred!: (value: { options: Array<{ id: string; label: string }> }) => void;
        let signal: AbortSignal | undefined;
        // A non-abort-honouring RPC: it ignores the signal and still settles
        // successfully after the popover closed, so only the hook's own
        // unmount/abort guards can keep the late rows out of the cache.
        const section: SelectionListDynamicSection = {
            id: 'in-this-folder',
            resolverKey: 'machine:m1',
            resolve: (_seed: string, abortSignal: AbortSignal) => {
                signal = abortSignal;
                return new Promise((res) => {
                    resolveDeferred = res;
                });
            },
            debounceMs: 0,
        };
        await act(async () => {
            renderer = createRenderer(
                <HostHarness dynamicSections={[section]} inputValue="~/Documents/" cache={cache} onState={onState} />,
            );
        });
        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        expect(signal?.aborted).toBe(false);
        // Unmount BEFORE the resolve completes.
        await act(async () => {
            renderer!.unmount();
            renderer = null;
        });
        expect(signal?.aborted).toBe(true);
        // Now resolve the deferred — this would have written to the cache if
        // the cache write fired on every success, regardless of abort. The
        // abort-safe contract means the cache stays empty for this key.
        await act(async () => {
            resolveDeferred({ options: [{ id: 'late', label: 'Late' }] });
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(cache.size()).toBe(0);

        // Remount with the same section + seed: the cache must still be empty.
        onState = vi.fn();
        await act(async () => {
            renderer = createRenderer(
                <HostHarness dynamicSections={[section]} inputValue="~/Documents/" cache={cache} onState={onState} />,
            );
        });
        const initial = lastState().get('in-this-folder');
        expect(initial?.lastSuccessOptions).toBeUndefined();
    });
});
