import { describe, expect, it } from 'vitest';

import {
    resolveNativeScrollReadOnlyVisibleBottomDecision,
    resolveNativeScrollReadOnlyVisibleBottomGenericEffects,
} from './nativeScrollReadOnlyVisibleBottom';

describe('native scroll read-only visible-bottom decision', () => {
    const releasedVisibleBottom = {
        bottomFollowMode: 'released' as const,
        distanceFromLiveTailPx: 0,
        followIntentIsPinned: true,
        followIntentWantsPinned: true,
        isTrusted: false,
        pinnedOffsetThresholdPx: 72,
    };

    it('records passive native visible-bottom observations while released', () => {
        expect(resolveNativeScrollReadOnlyVisibleBottomDecision(releasedVisibleBottom)).toEqual({
            distanceFromLiveTailPx: 0,
            pinnedOffsetThresholdPx: 72,
            type: 'record-visible-bottom',
        });
    });

    it.each([
        { case: 'trusted observations', overrides: { isTrusted: true }, reason: 'trusted-observation' },
        { case: 'observations while already following', overrides: { bottomFollowMode: 'following' as const }, reason: 'already-following' },
        {
            case: 'observations when the resolved intent is not visibly pinned',
            overrides: { distanceFromLiveTailPx: 96, followIntentIsPinned: false },
            reason: 'not-visible-live-tail',
        },
        {
            case: 'observations when the resolved intent does not want the live tail',
            overrides: { followIntentWantsPinned: false },
            reason: 'not-wants-pinned',
        },
    ])('ignores $case', ({ overrides, reason }) => {
        expect(resolveNativeScrollReadOnlyVisibleBottomDecision({
            ...releasedVisibleBottom,
            ...overrides,
        })).toEqual({
            reason,
            type: 'ignore',
        });
    });

    it('creates a session-scoped generic read-only visible-bottom effect only for record decisions', () => {
        expect(resolveNativeScrollReadOnlyVisibleBottomGenericEffects({
            distanceFromLiveTailPx: 3.5,
            pinnedOffsetThresholdPx: 72,
            type: 'record-visible-bottom',
        }, {
            pinEnabled: true,
            sessionId: 'session-a',
        })).toEqual([{
            sessionId: 'session-a',
            state: {
                jumpButtonDistanceFromLiveTailPx: 3.5,
                lastDistanceFromLiveTailPx: 3.5,
                scrollPinEvent: {
                    enabled: true,
                    offsetY: 3.5,
                    pinnedOffsetThresholdPx: 72,
                    type: 'scroll',
                },
            },
            type: 'apply-generic-read-only-visible-bottom-state',
        }]);
        expect(resolveNativeScrollReadOnlyVisibleBottomGenericEffects({
            reason: 'trusted-observation',
            type: 'ignore',
        }, {
            pinEnabled: true,
            sessionId: 'session-a',
        })).toEqual([]);
    });
});
