import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const accessibilityPlatform = vi.hoisted(() => ({ os: 'web' as 'web' | 'ios' | 'android' }));
const announceForAccessibilityMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const base = await createReactNativeWebMock({ View: 'View' });
    return {
        ...base,
        AccessibilityInfo: {
            ...base.AccessibilityInfo,
            announceForAccessibility: announceForAccessibilityMock,
        },
        Platform: {
            ...base.Platform,
            get OS() {
                return accessibilityPlatform.os;
            },
        },
    };
});

const { PoliteAccessibilityStatus } = await import('./PoliteAccessibilityStatus');

function status(announcement: string, transitionKey: string) {
    return React.createElement(PoliteAccessibilityStatus, {
        announcement,
        statusTestID: 'operation-a11y-status',
        transitionKey,
    });
}

describe('PoliteAccessibilityStatus', () => {
    it('speaks only on transitions on iOS: silent on mount and on empty states, coalescing same-key text', async () => {
        accessibilityPlatform.os = 'ios';
        announceForAccessibilityMock.mockClear();

        // The state a surface mounts with is already on screen; it is not news.
        const screen = await renderScreen(status('Loading history…', 'loading'));

        expect(announceForAccessibilityMock).not.toHaveBeenCalled();

        await screen.update(status('History could not be loaded.', 'failed'));

        expect(announceForAccessibilityMock).toHaveBeenCalledTimes(1);
        expect(announceForAccessibilityMock).toHaveBeenLastCalledWith('History could not be loaded.');

        // New text under the same transition coalesces, as it does on web/Android.
        await screen.update(status('History still could not be loaded.', 'failed'));

        expect(announceForAccessibilityMock).toHaveBeenCalledTimes(1);

        // An empty announcement is not a message: speaking it only cuts off
        // whatever VoiceOver is currently reading.
        await screen.update(status('', 'ready'));

        expect(announceForAccessibilityMock).toHaveBeenCalledTimes(1);

        // ...but the silent state still counts as a transition, so the very same
        // message returning after it is announced again instead of being deduped.
        await screen.update(status('History could not be loaded.', 'failed'));

        expect(announceForAccessibilityMock).toHaveBeenCalledTimes(2);
        expect(announceForAccessibilityMock).toHaveBeenLastCalledWith('History could not be loaded.');
    });
});
