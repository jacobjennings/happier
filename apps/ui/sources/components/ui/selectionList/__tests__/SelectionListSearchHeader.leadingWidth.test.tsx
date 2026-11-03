import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { setReducedMotionPreferenceOverride } from '@/hooks/ui/useReducedMotionPreference';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

/**
 * R6 — Premium UI design polish (Fix 3): the header leading slot must animate
 * its WIDTH (not only opacity) when swapping between the search icon and the
 * back chip so the input doesn't jump horizontally during step transitions.
 *
 * The width animation is driven by a reanimated `useAnimatedStyle` so the test
 * asserts on the resolved style of the leading-slot wrapper exposed under a
 * stable testID. The reanimated mock in `vitestSetup.ts` returns the factory
 * value synchronously, so the test sees the resolved style for the current
 * `canPop` state.
 */
type Screen = Awaited<ReturnType<typeof renderScreen>>;

function readAnimatorWidth(screen: Screen): unknown {
    const animator = screen.findByTestId('hdr:leading:animator');
    expect(animator).not.toBeNull();
    const styles = Array.isArray(animator!.props.style)
        ? animator!.props.style.flat(Infinity)
        : [animator!.props.style];
    return Object.assign({}, ...styles.filter(Boolean)).width;
}

describe('SelectionListSearchHeader leading slot width animation (R6 Fix 3)', () => {
    afterEach(async () => {
        // A host-wide store: restore it inside act so a still-mounted header rerenders in-band.
        await act(async () => { setReducedMotionPreferenceOverride(null); });
    });

    it.each([
        // Search-icon resting width is modest (icon + small chrome); the back chip is meaningfully wider.
        { slot: 'search icon', canPop: false, inRange: (width: number) => width > 0 && width < 60 },
        { slot: 'back chip', canPop: true, inRange: (width: number) => width >= 60 },
    ])('mounts the animated leading slot at the $slot resting width', async ({ canPop, inRange }) => {
        const { SelectionListSearchHeader } = await import('../SelectionListSearchHeader');
        const screen = await renderScreen(
            <SelectionListSearchHeader
                value=""
                onChangeText={() => {}}
                placeholder="Search"
                canPop={canPop}
                backLabel="Worktrees"
                onPopStep={() => {}}
                testID="hdr"
            />,
        );
        const width = readAnimatorWidth(screen);
        expect(typeof width).toBe('number');
        expect(inRange(width as number)).toBe(true);
    });

    it('snaps to the target width without animation when reduced motion is active', async () => {
        await act(async () => { setReducedMotionPreferenceOverride(true); });
        const { SelectionListSearchHeader } = await import('../SelectionListSearchHeader');
        // Render once with canPop false then update to canPop true under the
        // host reduced-motion preference and verify the width has changed (snap
        // rather than mid-tween value).
        const screen = await renderScreen(
            <SelectionListSearchHeader
                value=""
                onChangeText={() => {}}
                placeholder="Search"
                canPop={false}
                testID="hdr"
            />,
        );
        const beforeWidth = readAnimatorWidth(screen);
        await screen.update(
            <SelectionListSearchHeader
                value=""
                onChangeText={() => {}}
                placeholder="Search"
                canPop
                backLabel="Worktrees"
                onPopStep={() => {}}
                testID="hdr"
            />,
        );
        const afterWidth = readAnimatorWidth(screen) as number;
        expect(afterWidth).not.toBe(beforeWidth);
        expect(afterWidth).toBeGreaterThanOrEqual(60);
    });
});
