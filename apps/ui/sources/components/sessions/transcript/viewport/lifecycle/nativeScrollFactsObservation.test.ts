import { describe, expect, it } from 'vitest';

import { createTranscriptViewportLifecycle } from './lifecycle';
import { resolveNativeScrollFactsObservationEffects } from './nativeScrollFactsObservation';

function enterNativeSession(params: Readonly<{ gestureStarted: boolean; shouldFollowLiveTail: boolean }>) {
    const lifecycle = createTranscriptViewportLifecycle();
    lifecycle.dispatch({
        platform: 'native',
        sessionId: 'session-a',
        shouldFollowLiveTail: params.shouldFollowLiveTail,
        type: 'session-entry',
    });
    if (params.gestureStarted) {
        lifecycle.dispatch({ sessionId: 'session-a', type: 'gesture-start' });
    }
    return lifecycle;
}

describe('native scroll facts observation decision', () => {
    it.each([
        { case: 'a trusted frame', isTrusted: true },
        { case: 'an untrusted frame with recent user intent', isTrusted: false },
    ])('emits release effects for active native drag away facts from $case', ({ isTrusted }) => {
        const lifecycle = enterNativeSession({ gestureStarted: true, shouldFollowLiveTail: true });

        expect(resolveNativeScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx: 96,
            isTrusted,
            movedAwayFromLiveTail: true,
            movedTowardLiveTail: false,
            pinThresholdPx: 72,
            recentUserIntent: true,
            sessionId: 'session-a',
        })).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'native-scroll-release-live-tail' }),
        ]));
    });

    it('returns no effects for untrusted away churn without recent user intent during a drag', () => {
        const lifecycle = enterNativeSession({ gestureStarted: true, shouldFollowLiveTail: true });

        expect(resolveNativeScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx: 96,
            isTrusted: false,
            movedAwayFromLiveTail: true,
            movedTowardLiveTail: false,
            pinThresholdPx: 72,
            recentUserIntent: false,
            sessionId: 'session-a',
        })).toEqual([]);
    });

    it('returns a released reader to the live tail on trusted movement toward it', () => {
        const lifecycle = enterNativeSession({ gestureStarted: false, shouldFollowLiveTail: false });

        expect(resolveNativeScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx: 48,
            isTrusted: true,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: true,
            pinThresholdPx: 72,
            recentUserIntent: false,
            sessionId: 'session-a',
        })).toEqual([
            expect.objectContaining({ distanceFromLiveTailPx: 48, isPinned: true, type: 'viewport-change' }),
            expect.objectContaining({ distanceFromLiveTailPx: 48, isPinned: true, type: 'drain-deferred-newer' }),
        ]);
    });

    it.each([24, 72])('emits observed viewport-state effects for passive native facts at distance %s', (distanceFromLiveTailPx) => {
        const lifecycle = enterNativeSession({ gestureStarted: false, shouldFollowLiveTail: true });

        expect(resolveNativeScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx,
            isTrusted: false,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: false,
            pinThresholdPx: 72,
            recentUserIntent: false,
            sessionId: 'session-a',
        })).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'native-observed-viewport-state' }),
        ]));
    });
});
