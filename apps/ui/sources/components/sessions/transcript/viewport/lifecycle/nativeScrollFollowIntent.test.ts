import { describe, expect, it } from 'vitest';

import { resolveNativeScrollFollowIntent } from './nativeScrollFollowIntent';

describe('native scroll follow intent', () => {
    const baseParams = {
        distanceFromLiveTailForReleasePx: 96,
        distanceFromLiveTailPx: 96,
        hasOpenTrustedAwayGesture: false,
        hasTrustedDragSession: false,
        isTrusted: true,
        movedTowardLiveTail: false,
        nativeMomentumScrollActive: false,
        pinThresholdPx: 72,
        previousScrollOffset: 120,
        scrollOffset: 80,
        wantsPinned: true,
    };

    it.each([
        { distanceFromLiveTailForReleasePx: 96, distanceFromLiveTailPx: 96, released: true },
        { distanceFromLiveTailForReleasePx: 96, distanceFromLiveTailPx: 24, released: true },
        { distanceFromLiveTailForReleasePx: 24, distanceFromLiveTailPx: 96, released: false },
    ])(
        'gates trusted native away release on the release distance $distanceFromLiveTailForReleasePx (intent distance $distanceFromLiveTailPx)',
        ({ distanceFromLiveTailForReleasePx, distanceFromLiveTailPx, released }) => {
            expect(resolveNativeScrollFollowIntent({
                ...baseParams,
                distanceFromLiveTailForReleasePx,
                distanceFromLiveTailPx,
            })).toMatchObject({
                released,
                wantsPinned: !released,
            });
        },
    );

    it('does not release inverted trusted movement inside the live-tail threshold', () => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            distanceFromLiveTailForReleasePx: 24,
            distanceFromLiveTailPx: 24,
        })).toMatchObject({
            released: false,
            wantsPinned: true,
        });
    });

    it('releases untrusted post-drag momentum while a trusted drag session is active', () => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            hasTrustedDragSession: true,
            isTrusted: false,
            nativeMomentumScrollActive: true,
        })).toMatchObject({
            released: true,
            wantsPinned: false,
        });
    });

    it('does not release untrusted momentum without a retained trusted drag session', () => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            hasTrustedDragSession: false,
            isTrusted: false,
            nativeMomentumScrollActive: true,
        })).toMatchObject({
            released: false,
            wantsPinned: true,
        });
    });

    it('rearms an untrusted bottom frame when no trusted away gesture is open', () => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            distanceFromLiveTailForReleasePx: 0,
            distanceFromLiveTailPx: 0,
            hasOpenTrustedAwayGesture: false,
            isTrusted: false,
            previousScrollOffset: 80,
            scrollOffset: 120,
            wantsPinned: false,
        })).toMatchObject({
            rearmed: true,
            wantsPinned: true,
        });
    });

    it('blocks stale bottom rearm while a trusted away gesture is still open', () => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            distanceFromLiveTailForReleasePx: 0,
            distanceFromLiveTailPx: 0,
            hasOpenTrustedAwayGesture: true,
            isTrusted: false,
            previousScrollOffset: 80,
            scrollOffset: 120,
            wantsPinned: false,
        })).toMatchObject({
            isPinned: false,
            rearmed: false,
            wantsPinned: false,
        });
    });

    it('rearms when trusted movement returns toward the live tail', () => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            distanceFromLiveTailForReleasePx: 24,
            distanceFromLiveTailPx: 24,
            hasOpenTrustedAwayGesture: true,
            isTrusted: true,
            movedTowardLiveTail: true,
            previousScrollOffset: 80,
            scrollOffset: 120,
            wantsPinned: false,
        })).toMatchObject({
            rearmed: true,
            wantsPinned: true,
        });
    });

    it.each([
        { case: 'trusted movement that does not move toward the live tail', isTrusted: true, movedTowardLiveTail: false },
        { case: 'untrusted movement toward the live tail', isTrusted: false, movedTowardLiveTail: true },
    ])('blocks rearm from $case while a trusted away gesture is open', ({ isTrusted, movedTowardLiveTail }) => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            distanceFromLiveTailForReleasePx: 0,
            distanceFromLiveTailPx: 0,
            hasOpenTrustedAwayGesture: true,
            isTrusted,
            movedTowardLiveTail,
            previousScrollOffset: 80,
            scrollOffset: 120,
            wantsPinned: false,
        })).toMatchObject({
            rearmed: false,
            wantsPinned: false,
        });
    });

    it('does not release untrusted churn without release authority', () => {
        expect(resolveNativeScrollFollowIntent({
            ...baseParams,
            hasTrustedDragSession: false,
            isTrusted: false,
            nativeMomentumScrollActive: false,
        })).toMatchObject({
            released: false,
            wantsPinned: true,
        });
    });
});
