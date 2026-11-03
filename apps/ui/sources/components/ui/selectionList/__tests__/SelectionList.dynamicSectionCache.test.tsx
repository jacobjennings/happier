import * as React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import {
    createDefaultDynamicSectionCache,
    getDefaultDynamicSectionCache,
    type SelectionListDynamicSectionCache,
} from '../selectionListDynamicSectionCache';
import type {
    SelectionListDynamicSection,
    SelectionListProps,
    SelectionListStep,
} from '../_types';

/**
 * UNIVERSAL-SEARCH §3.2 — the sensitive-cache seam must be reachable through
 * the SelectionList component itself, not only through the hook. Universal
 * Search injects an auth-lifetime cache and clears it on logout/Account
 * replacement; sensitive rows (transcript excerpts, private project names)
 * must never survive that boundary through the default cross-mount singleton.
 *
 * Component-level contract:
 *   1. An injected cache — and only it — feeds cross-mount replays: clearing
 *      the production singleton between mounts cannot erase rows the injected
 *      auth-lifetime cache still holds.
 *   2. Clearing the injected cache (Account replacement) removes the replay
 *      source: the next mount must not show stale rows before its own fetch
 *      resolves, and the resolver must run again.
 */

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

function makeStep(section: SelectionListDynamicSection): SelectionListStep {
    return {
        id: 'root',
        inputPlaceholder: 'Search',
        sections: [{ kind: 'dynamic', ...section }],
    };
}

function defaultProps(rootStep: SelectionListStep): SelectionListProps {
    return {
        rootStep,
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        keyboardHintsEnabled: false,
        disableTransitions: true,
        testID: 'sl',
    };
}

const SEED_INPUT = 'query';
const SECTION_ID = 'results';

function makeSection(resolve: SelectionListDynamicSection['resolve']): SelectionListDynamicSection {
    return {
        id: SECTION_ID,
        title: 'Results',
        resolverKey: 'account:replaced-check',
        debounceMs: 0,
        resultFiltering: 'provider',
        resolve,
    };
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
    vi.useRealTimers();
});

async function flushResolve(): Promise<void> {
    const { act } = await import('react-test-renderer');
    await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('SelectionList — injectable dynamic-section cache', () => {
    it('replays cross-mount rows from the injected cache, not the default singleton', async () => {
        const { act } = await import('react-test-renderer');
        const { SelectionList } = await import('../SelectionList');
        const cache: SelectionListDynamicSectionCache = createDefaultDynamicSectionCache();
        const firstRows = [{ id: 'r1', label: 'First mount row' }];
        const resolver = vi.fn(async () => ({ options: firstRows }));
        const props = defaultProps(makeStep(makeSection(resolver)));

        const first = await renderScreen(
            <SelectionList {...props} inputValue={SEED_INPUT} dynamicSectionCache={cache} />,
        );
        await flushResolve();
        expect(first.findByTestId(`sl:root:option:${firstRows[0]!.id}`)).not.toBeNull();
        expect(cache.size()).toBe(1);

        await act(async () => {
            first.unmount();
        });
        // Erase every other replay source: only the injected cache may feed
        // the next mount.
        getDefaultDynamicSectionCache().clear();

        // The remount resolver would publish different rows; before its fetch
        // dispatches, the injected cache's rows must already be visible.
        const remountResolver = vi.fn(() => new Promise<{ options: ReadonlyArray<{ id: string; label: string }> }>(() => {
            // Keep revalidation pending so the assertion observes the precise
            // stale-while-revalidate window supplied by the injected cache.
        }));
        const second = await renderScreen(
            <SelectionList
                {...defaultProps(makeStep(makeSection(remountResolver)))}
                inputValue={SEED_INPUT}
                dynamicSectionCache={cache}
            />,
        );

        expect(second.findByTestId(`sl:root:option:${firstRows[0]!.id}`)).not.toBeNull();

        await act(async () => {
            second.unmount();
        });
    });

    it('shows no stale rows after the injected cache is cleared on Account replacement', async () => {
        const { act } = await import('react-test-renderer');
        const { SelectionList } = await import('../SelectionList');
        const cache: SelectionListDynamicSectionCache = createDefaultDynamicSectionCache();
        const resolver = vi.fn(async () => ({ options: [{ id: 'r1', label: 'Private row' }] }));
        const props = defaultProps(makeStep(makeSection(resolver)));

        const first = await renderScreen(
            <SelectionList {...props} inputValue={SEED_INPUT} dynamicSectionCache={cache} />,
        );
        await flushResolve();
        expect(first.findByTestId('sl:root:option:r1')).not.toBeNull();

        await act(async () => {
            first.unmount();
        });

        // Logout / Account replacement clears the auth-lifetime cache.
        cache.clear();

        // The fresh account's fetch is held open so the pre-fetch window is
        // deterministic: nothing from the previous account may surface while
        // it is in flight.
        let releaseRemount: ((result: { options: ReadonlyArray<{ id: string; label: string }> }) => void) | undefined;
        const remountResolver = vi.fn(() => new Promise<{
            options: ReadonlyArray<{ id: string; label: string }>;
        }>((resolvePromise) => {
            releaseRemount = resolvePromise as typeof releaseRemount;
        }));
        const second = await renderScreen(
            <SelectionList
                {...defaultProps(makeStep(makeSection(remountResolver)))}
                inputValue={SEED_INPUT}
                dynamicSectionCache={cache}
            />,
        );

        // Before the fresh fetch resolves, nothing from the previous account
        // may surface — the section must not replay cleared rows.
        expect(second.findAllByProps({ testID: 'sl:root:option:r1' })).toHaveLength(0);
        // And the section must genuinely refetch instead of replaying.
        expect(remountResolver).toHaveBeenCalled();
        await act(async () => {
            releaseRemount?.({ options: [{ id: 'r2', label: 'Fresh row' }] });
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(second.findByTestId('sl:root:option:r2')).not.toBeNull();

        await act(async () => {
            second.unmount();
        });
    });
});
