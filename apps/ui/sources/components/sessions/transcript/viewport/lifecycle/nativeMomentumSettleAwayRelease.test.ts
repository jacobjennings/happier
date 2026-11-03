import { describe, expect, it } from 'vitest';

import {
    resolveNativeMomentumSettleAwayReleaseStateEffects,
    type NativeMomentumSettleAwayReleaseInputEffect,
} from './nativeMomentumSettleAwayRelease';

const releaseEffect = (overrides: Partial<NativeMomentumSettleAwayReleaseInputEffect> = {}): NativeMomentumSettleAwayReleaseInputEffect => ({
    distanceFromLiveTailPx: 18.75,
    sessionId: 'session-a',
    type: 'native-momentum-settle-away-release-live-tail',
    ...overrides,
});

describe('native momentum settle-away release', () => {
    it.each([true, false])('maps a matching release effect to released viewport and scroll-pin state (pin enabled: %s)', (pinEnabled) => {
        expect(resolveNativeMomentumSettleAwayReleaseStateEffects({
            effects: [releaseEffect()],
            pinEnabled,
            sessionId: 'session-a',
            wantsPinned: true,
        })).toEqual([{
            distanceFromLiveTailPx: 18.75,
            scrollPinEvent: {
                enabled: pinEnabled,
                offsetY: 18.75,
                pinnedOffsetThresholdPx: 0,
                type: 'scroll',
            },
            sessionId: 'session-a',
            type: 'apply-native-momentum-settle-away-release-state',
            viewportState: {
                isPinned: false,
                offsetY: 18.75,
                shouldRestoreViewport: true,
            },
        }]);
    });

    it('does not emit release state when follow is already released', () => {
        expect(resolveNativeMomentumSettleAwayReleaseStateEffects({
            effects: [releaseEffect()],
            pinEnabled: true,
            sessionId: 'session-a',
            wantsPinned: false,
        })).toEqual([]);
    });

    it.each([
        { case: 'for a stale session', effects: [releaseEffect({ sessionId: 'session-b' })] },
        { case: 'without a release effect', effects: [] },
    ])('does not emit release state $case', ({ effects }) => {
        expect(resolveNativeMomentumSettleAwayReleaseStateEffects({
            effects,
            pinEnabled: true,
            sessionId: 'session-a',
            wantsPinned: true,
        })).toEqual([]);
    });
});
