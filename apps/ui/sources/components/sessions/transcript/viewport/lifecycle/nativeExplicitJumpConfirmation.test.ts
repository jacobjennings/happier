import { describe, expect, it } from 'vitest';

import {
    resolveNativeExplicitJumpConfirmationEffects,
    type NativeExplicitJumpConfirmationState,
} from './nativeExplicitJumpConfirmation';

const pending: NativeExplicitJumpConfirmationState = {
    issuedContentHeight: 1200,
    reconfirmSpent: false,
    sessionId: 'session-1',
};

describe('native explicit jump confirmation', () => {
    it('clears stale-session and trusted-scroll pending confirmation without consuming the observation', () => {
        for (const observation of [
            {
                contentHeight: 1200,
                distanceFromBottom: 120,
                isTrusted: false,
                pinThresholdPx: 72,
                sessionId: 'session-2',
            },
            {
                contentHeight: 1200,
                distanceFromBottom: 120,
                isTrusted: true,
                pinThresholdPx: 72,
                sessionId: 'session-1',
            },
        ]) {
            expect(resolveNativeExplicitJumpConfirmationEffects({
                pending,
                observation,
            })).toEqual({
                consumed: false,
                effects: [],
                pending: null,
            });
        }
    });

    it('spends exactly one reconfirm write when content height changes before bottom arrival', () => {
        expect(resolveNativeExplicitJumpConfirmationEffects({
            pending,
            observation: {
                contentHeight: 1500,
                distanceFromBottom: 180,
                isTrusted: false,
                pinThresholdPx: 72,
                sessionId: 'session-1',
            },
        })).toEqual({
            consumed: true,
            effects: [{ type: 'issue-reconfirm-jump-to-bottom', sessionId: 'session-1' }],
            pending: {
                issuedContentHeight: 1500,
                reconfirmSpent: true,
                sessionId: 'session-1',
            },
        });
    });

    it('leaves unchanged off-bottom observations unconsumed', () => {
        expect(resolveNativeExplicitJumpConfirmationEffects({
            pending,
            observation: {
                contentHeight: 1200,
                distanceFromBottom: 180,
                isTrusted: false,
                pinThresholdPx: 72,
                sessionId: 'session-1',
            },
        })).toEqual({
            consumed: false,
            effects: [],
            pending,
        });
    });
});
