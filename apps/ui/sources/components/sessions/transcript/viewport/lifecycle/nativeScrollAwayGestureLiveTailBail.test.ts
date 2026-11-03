import { describe, expect, it } from 'vitest';

import {
    type NativeScrollAwayGestureLiveTailBailDecision,
    type NativeScrollAwayGestureLiveTailBailEffect,
    resolveNativeScrollAwayGestureLiveTailBailDecision,
    resolveNativeScrollAwayGestureLiveTailBailEffects,
} from './nativeScrollAwayGestureLiveTailBail';

type ResolveNativeScrollAwayGestureLiveTailBailEffectsInput = Readonly<{
    decision: NativeScrollAwayGestureLiveTailBailDecision;
    distanceFromLiveTailPx: number;
    isTrusted: boolean;
    movedAwayFromLiveTail: boolean;
    movedTowardLiveTail: boolean;
    nativeListDragActive: boolean;
    recentUserIntent: boolean;
    sessionId: string;
}>;

function resolveBailEffects(
    overrides: Partial<ResolveNativeScrollAwayGestureLiveTailBailEffectsInput> = {},
): readonly NativeScrollAwayGestureLiveTailBailEffect[] {
    return resolveNativeScrollAwayGestureLiveTailBailEffects({
        decision: { type: 'bail' },
        distanceFromLiveTailPx: 24,
        isTrusted: false,
        movedAwayFromLiveTail: false,
        movedTowardLiveTail: false,
        nativeListDragActive: false,
        recentUserIntent: false,
        sessionId: 'session-1',
        ...overrides,
    });
}

const openAwayGestureFacts = {
    hasOpenTrustedAwayGesture: true,
    isTrusted: false,
    pinThresholdPx: 72,
};

describe('native scroll away gesture live-tail bail decision', () => {
    it.each([
        { distanceFromLiveTailPx: 72, expected: { type: 'bail' } },
        { distanceFromLiveTailPx: 73, expected: { reason: 'outside-live-tail-threshold', type: 'continue' } },
        // Non-finite distance facts continue, preserving the original threshold comparison.
        { distanceFromLiveTailPx: Number.NaN, expected: { reason: 'outside-live-tail-threshold', type: 'continue' } },
    ])(
        'decides an untrusted frame at distance $distanceFromLiveTailPx during an open native away gesture',
        ({ distanceFromLiveTailPx, expected }) => {
            expect(resolveNativeScrollAwayGestureLiveTailBailDecision({
                ...openAwayGestureFacts,
                distanceFromLiveTailPx,
            })).toEqual(expected);
        },
    );

    it('continues when no trusted away gesture is open', () => {
        expect(resolveNativeScrollAwayGestureLiveTailBailDecision({
            ...openAwayGestureFacts,
            distanceFromLiveTailPx: 0,
            hasOpenTrustedAwayGesture: false,
        })).toEqual({ reason: 'no-open-trusted-away-gesture', type: 'continue' });
    });

    it('continues for trusted native frames so normal release/rearm handling can run', () => {
        expect(resolveNativeScrollAwayGestureLiveTailBailDecision({
            ...openAwayGestureFacts,
            distanceFromLiveTailPx: 0,
            isTrusted: true,
        })).toEqual({ reason: 'trusted-observation', type: 'continue' });
    });

    it('emits observe-scroll-facts before consume when an active native drag is still open', () => {
        expect(resolveBailEffects({
            distanceFromLiveTailPx: 24,
            isTrusted: false,
            movedAwayFromLiveTail: true,
            movedTowardLiveTail: false,
            nativeListDragActive: true,
            recentUserIntent: true,
            sessionId: 'session-1',
        })).toEqual([
            {
                distanceFromLiveTailPx: 24,
                isTrusted: false,
                movedAwayFromLiveTail: true,
                movedTowardLiveTail: false,
                recentUserIntent: true,
                sessionId: 'session-1',
                type: 'observe-native-scroll-facts',
            },
            { type: 'consume-observation', sessionId: 'session-1' },
        ]);
    });

    it('emits consume for inverted bails even when no writes are needed', () => {
        expect(resolveBailEffects({
            distanceFromLiveTailPx: 0,
            isTrusted: false,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: false,
            nativeListDragActive: false,
            recentUserIntent: false,
            sessionId: 'session-1',
        })).toEqual([{ type: 'consume-observation', sessionId: 'session-1' }]);
    });

    it('returns no effects for continue decisions', () => {
        expect(resolveBailEffects({
            decision: { reason: 'trusted-observation', type: 'continue' },
            distanceFromLiveTailPx: 0,
            isTrusted: true,
            movedAwayFromLiveTail: true,
            movedTowardLiveTail: false,
            nativeListDragActive: true,
            recentUserIntent: true,
            sessionId: 'session-1',
        })).toEqual([]);
    });
});
