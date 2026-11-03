import { describe, expect, it } from 'vitest';

import {
    resolveNativeBottomFollowRearmResetEffects,
    type NativeBottomFollowRearmResetInputEffect,
} from './nativeBottomFollowRearmReset';

const resetEffect = (
    overrides: Partial<NativeBottomFollowRearmResetInputEffect> = {},
): NativeBottomFollowRearmResetInputEffect => ({
    sessionId: 'session-a',
    type: 'native-bottom-follow-rearm-reset',
    ...overrides,
});

describe('native bottom-follow rearm reset', () => {
    it('filters mixed effects down to every current-session reset', () => {
        expect(resolveNativeBottomFollowRearmResetEffects({
            effects: [
                resetEffect(),
                resetEffect({ sessionId: 'session-b' }),
                {
                    distanceFromLiveTailPx: 4,
                    sessionId: 'session-a',
                    type: 'native-bottom-follow-rearm',
                },
                resetEffect(),
            ],
            sessionId: 'session-a',
        })).toEqual([
            {
                sessionId: 'session-a',
                type: 'reset-native-bottom-follow-rearm',
            },
            {
                sessionId: 'session-a',
                type: 'reset-native-bottom-follow-rearm',
            },
        ]);
    });
});
