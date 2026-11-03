import { describe, expect, it } from 'vitest';

import {
    resolveNativeBottomFollowRearmAdoptionDecision,
    type NativeBottomFollowRearmAdoptionInputEffect,
} from './nativeBottomFollowRearmAdoption';

const rearmEffect = (overrides: Partial<NativeBottomFollowRearmAdoptionInputEffect> = {}): NativeBottomFollowRearmAdoptionInputEffect => ({
    distanceFromLiveTailPx: 9.5,
    sessionId: 'session-a',
    type: 'native-bottom-follow-rearm',
    ...overrides,
});

describe('native bottom-follow rearm adoption', () => {
    it.each([
        { case: 'no rearm effect exists', effects: [] },
        { case: 'the only rearm effect is from a stale session', effects: [rearmEffect({ sessionId: 'session-b' })] },
    ])('returns not consumed when $case', ({ effects }) => {
        expect(resolveNativeBottomFollowRearmAdoptionDecision({
            effects,
            hasRearmedNativeBottomFollow: false,
            sessionId: 'session-a',
        })).toEqual({ consumed: false, effects: [] });
    });

    it.each([
        { case: 'a single matching rearm', effects: [rearmEffect()], expectedDistancePx: 9.5 },
        {
            case: 'the first of several matching rearms',
            effects: [
                rearmEffect({ distanceFromLiveTailPx: 4 }),
                rearmEffect({ distanceFromLiveTailPx: 1 }),
            ],
            expectedDistancePx: 4,
        },
    ])('returns one adoption from $case when not already applied', ({ effects, expectedDistancePx }) => {
        expect(resolveNativeBottomFollowRearmAdoptionDecision({
            effects,
            hasRearmedNativeBottomFollow: false,
            sessionId: 'session-a',
        })).toEqual({
            consumed: true,
            effects: [{
                distanceFromLiveTailPx: expectedDistancePx,
                sessionId: 'session-a',
                type: 'adopt-native-bottom-follow-rearm',
            }],
        });
    });

    it('consumes a matching rearm without adoption after native bottom follow is already rearmed', () => {
        expect(resolveNativeBottomFollowRearmAdoptionDecision({
            effects: [rearmEffect()],
            hasRearmedNativeBottomFollow: true,
            sessionId: 'session-a',
        })).toEqual({ consumed: true, effects: [] });
    });
});
