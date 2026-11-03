import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

/**
 * R6 — Premium UI design polish (Fix 4): the footer hint set must cross-fade
 * when the visible step swaps in a different `hints` array, instead of
 * snapping via React mount/unmount.
 *
 * Implementation contract:
 *  - The hints row is wrapped in an animated container exposed under a stable
 *    testID `<footer>:hints-animator` carrying an opacity style entry.
 *  - When the hints set changes, the animator's opacity value is re-driven via
 *    `withTiming` (mocked here to pass-through the target value); once the
 *    swap finishes the animator is back at full opacity.
 */

function animatorOpacity(animator: { props: { style?: unknown } } | null): unknown {
    const style = animator?.props.style;
    const styles = (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean);
    return Object.assign({}, ...styles).opacity;
}

describe('SelectionListFooter hint cross-fade (R6 Fix 4)', () => {
    it('keeps the animator wrapper mounted across a hints identity swap (no remount flicker)', async () => {
        const { SelectionListFooter } = await import('../SelectionListFooter');
        const screen = await renderScreen(
            <SelectionListFooter
                hints={[
                    { id: 'navigate', label: '↑↓', description: 'navigate' },
                ]}
                hardwareKeyboardAvailable
                testID="footer"
            />,
        );
        const before = screen.findByTestId('footer:hints-animator');
        expect(before).not.toBeNull();
        await screen.update(
            <SelectionListFooter
                hints={[
                    { id: 'enter', label: '↵', description: 'select' },
                    { id: 'tab', label: 'Tab', description: 'autocomplete' },
                ]}
                hardwareKeyboardAvailable
                testID="footer"
            />,
        );
        // The animator wrapper persists across the swap so opacity can animate
        // rather than React mounting/unmounting hint subtrees instantly.
        const after = screen.findByTestId('footer:hints-animator');
        expect(after).toBe(before);
    });

    it('finishes the swap when the same hints arrive again with a new identity mid-fade', async () => {
        vi.useFakeTimers();
        try {
            const { SelectionListFooter } = await import('../SelectionListFooter');
            const next = () => [{ id: 'open', label: '↵', description: 'Open at the line' }];
            const screen = await renderScreen(
                <SelectionListFooter hints={[{ id: 'move', label: '↑↓', description: 'Move' }]} hardwareKeyboardAvailable testID="footer" />,
            );
            await screen.update(<SelectionListFooter hints={next()} hardwareKeyboardAvailable testID="footer" />);
            // A parent re-render rebuilds the same hints (same ids) before the fade-out ends.
            await screen.update(<SelectionListFooter hints={next()} hardwareKeyboardAvailable testID="footer" />);
            await vi.advanceTimersByTimeAsync(2000);
            expect(screen.getTextContent()).toContain('Open at the line');
            expect(screen.getTextContent()).not.toContain('Move');
            // The fade finished: the footer is not left faded out on the new set.
            expect(animatorOpacity(screen.findByTestId('footer:hints-animator'))).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
