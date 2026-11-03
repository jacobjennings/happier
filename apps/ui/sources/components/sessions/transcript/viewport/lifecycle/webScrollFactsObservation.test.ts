import { describe, expect, it } from 'vitest';

import { createTranscriptViewportLifecycle } from './lifecycle';
import { resolveWebScrollFactsObservationEffects } from './webScrollFactsObservation';

describe('web scroll facts observation effects', () => {
    it('emits web release effects for genuine upward movement', () => {
        const lifecycle = createTranscriptViewportLifecycle();
        lifecycle.dispatch({
            sessionId: 'session-a',
            platform: 'web',
            shouldFollowLiveTail: true,
            type: 'session-entry',
        });

        expect(resolveWebScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx: 180.9,
            movedAwayFromLiveTail: true,
            movedTowardLiveTail: true,
            pinThresholdPx: 72,
            sessionId: 'session-a',
        })).toEqual([
            {
                distanceFromLiveTailPx: 180,
                isPinned: false,
                sessionId: 'session-a',
                type: 'web-release-live-tail',
            },
        ]);
    });

    it('emits observed-state effects for passive web content churn', () => {
        const lifecycle = createTranscriptViewportLifecycle();
        lifecycle.dispatch({
            sessionId: 'session-a',
            platform: 'web',
            shouldFollowLiveTail: true,
            type: 'session-entry',
        });

        expect(resolveWebScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx: 180,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: false,
            pinThresholdPx: 72,
            sessionId: 'session-a',
        })).toEqual([
            {
                distanceFromLiveTailPx: 180,
                isPinned: false,
                pinnedOffsetThresholdPx: 72,
                sessionId: 'session-a',
                shouldRestoreViewport: false,
                type: 'web-observed-viewport-state',
                wantsPinned: true,
            },
        ]);
    });

    it('emits return-to-live-tail effects when a released web reader reaches the tail', () => {
        const lifecycle = createTranscriptViewportLifecycle();
        lifecycle.dispatch({
            sessionId: 'session-a',
            platform: 'web',
            shouldFollowLiveTail: false,
            type: 'session-entry',
        });

        expect(resolveWebScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx: 12,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: true,
            pinThresholdPx: 72,
            sessionId: 'session-a',
        })).toEqual([
            {
                distanceFromLiveTailPx: 12,
                isPinned: true,
                sessionId: 'session-a',
                source: 'mode-following',
                type: 'viewport-change',
            },
            {
                distanceFromLiveTailPx: 12,
                isPinned: true,
                sessionId: 'session-a',
                type: 'drain-deferred-newer',
            },
        ]);
    });

    it('treats a fractional web distance within the pin threshold as reaching the tail', () => {
        const lifecycle = createTranscriptViewportLifecycle();
        lifecycle.dispatch({
            sessionId: 'session-a',
            platform: 'web',
            shouldFollowLiveTail: false,
            type: 'session-entry',
        });

        const effects = resolveWebScrollFactsObservationEffects({
            dispatch: lifecycle.dispatch,
            distanceFromLiveTailPx: 72.6,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: true,
            pinThresholdPx: 72,
            sessionId: 'session-a',
        });

        expect(effects.map((effect) => effect.type)).toEqual(['viewport-change', 'drain-deferred-newer']);
        expect(lifecycle.getState().bottomFollowState.mode).toBe('following');
    });
});
