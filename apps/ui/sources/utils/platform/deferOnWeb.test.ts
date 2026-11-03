import { afterEach, describe, expect, it, vi } from 'vitest';
import { withPopoverWebGlobals } from '@/dev/testkit/harness/popoverHarness';

const platform = vi.hoisted(() => ({ OS: 'web' as string }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() { return platform.OS; },
        },
    });
});

import { deferOnWeb } from './deferOnWeb';

type FrameScheduler = (callback: FrameRequestCallback) => number;

describe('deferOnWeb', () => {
    afterEach(() => {
        platform.OS = 'web';
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('defers execution on web', async () => {
        const action = vi.fn();
        let deferredFrame: ((timestamp: number) => void) | null = null;
        const frameScheduler: FrameScheduler = (callback) => {
            deferredFrame = callback;
            return 1;
        };

        await withPopoverWebGlobals(async () => {
            deferOnWeb(action);

            expect(action).not.toHaveBeenCalled();
            expect(deferredFrame).not.toBeNull();
            const runDeferredFrame =
                deferredFrame ??
                ((_timestamp: number) => {
                    throw new Error('Expected deferred frame callback to be scheduled');
                });
            runDeferredFrame(0);
            expect(action).toHaveBeenCalledTimes(1);
        }, { frameScheduler });
    });

    it('still runs the action when the web frame is stalled and only the timeout fallback can fire', async () => {
        vi.useFakeTimers();
        const rafSpy = vi.fn(() => 1);
        vi.stubGlobal('requestAnimationFrame', rafSpy);
        const action = vi.fn();

        deferOnWeb(action);

        expect(action).not.toHaveBeenCalled();
        await vi.runOnlyPendingTimersAsync();
        expect(action).toHaveBeenCalledTimes(1);
        expect(rafSpy).toHaveBeenCalledTimes(1);
    });

    it('runs immediately off web', () => {
        platform.OS = 'ios';
        const action = vi.fn();
        deferOnWeb(action);
        expect(action).toHaveBeenCalledTimes(1);
    });
});
