import { describe, expect, it } from 'vitest';

import {
    resolveNativeScrollPassiveDriftBailDecision,
    resolveNativeScrollPassiveDriftBailGenericEffects,
} from './nativeScrollPassiveDriftBail';

describe('native scroll passive-drift bail decision', () => {
    const nativeDrift = {
        bottomFollowMode: 'following' as const,
        followIntentIsPinned: false,
        followIntentWantsPinned: true,
        isTrusted: false,
    };

    it('suppresses generic observations for native passive drift while following', () => {
        expect(resolveNativeScrollPassiveDriftBailDecision(nativeDrift)).toEqual({ type: 'suppress-generic-observation' });
    });

    it('continues for trusted observations', () => {
        expect(resolveNativeScrollPassiveDriftBailDecision({
            ...nativeDrift,
            isTrusted: true,
        })).toEqual({
            reason: 'trusted-observation',
            type: 'continue',
        });
    });

    it('continues when follow state or resolved intent does not match native passive drift', () => {
        expect(resolveNativeScrollPassiveDriftBailDecision({
            ...nativeDrift,
            bottomFollowMode: 'released',
        })).toEqual({
            reason: 'not-following',
            type: 'continue',
        });

        expect(resolveNativeScrollPassiveDriftBailDecision({
            ...nativeDrift,
            followIntentWantsPinned: false,
        })).toEqual({
            reason: 'not-wants-live-tail',
            type: 'continue',
        });

        expect(resolveNativeScrollPassiveDriftBailDecision({
            ...nativeDrift,
            followIntentIsPinned: true,
        })).toEqual({
            reason: 'visible-live-tail',
            type: 'continue',
        });
    });

    it('packages only suppress decisions as session-scoped generic-observation suppression effects', () => {
        expect(resolveNativeScrollPassiveDriftBailGenericEffects({
            decision: { type: 'suppress-generic-observation' },
            sessionId: 'session-a',
        })).toEqual([{
            reason: 'native-passive-drift',
            sessionId: 'session-a',
            type: 'suppress-generic-scroll-observation',
        }]);
        expect(resolveNativeScrollPassiveDriftBailGenericEffects({
            decision: { reason: 'trusted-observation', type: 'continue' },
            sessionId: 'session-a',
        })).toEqual([]);
    });
});
