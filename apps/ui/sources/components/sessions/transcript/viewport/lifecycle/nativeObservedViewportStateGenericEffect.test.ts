import { describe, expect, it } from 'vitest';

import type { TranscriptViewportLifecycleEffect } from './lifecycle';
import {
    resolveNativeObservedViewportStateGenericLifecycleEffects,
} from './nativeObservedViewportStateGenericEffect';

type NativeObservedViewportStateEffect = Extract<
    TranscriptViewportLifecycleEffect,
    { type: 'native-observed-viewport-state' }
>;

function firstGenericObservedStateEffect(
    effects: readonly TranscriptViewportLifecycleEffect[],
): Extract<TranscriptViewportLifecycleEffect, { type: 'apply-generic-observed-viewport-state' }> {
    const effect = effects[0];
    expect(effect?.type).toBe('apply-generic-observed-viewport-state');
    if (!effect || effect.type !== 'apply-generic-observed-viewport-state') {
        throw new Error('expected generic observed-state effect');
    }
    return effect;
}

const followingObservedEffect = (
    overrides: Partial<NativeObservedViewportStateEffect> = {},
): NativeObservedViewportStateEffect => ({
    distanceFromLiveTailPx: 96,
    isPinned: false,
    pinnedOffsetThresholdPx: 72,
    sessionId: 'session-a',
    shouldRestoreViewport: false,
    type: 'native-observed-viewport-state',
    wantsPinned: true,
    ...overrides,
});

function resolveCurrentSessionObservedState(params: Readonly<{
    effect: NativeObservedViewportStateEffect;
    nextScrollOffsetPx: number;
    pinEnabled: boolean;
    suppressAnchorCapture: boolean;
}>) {
    return firstGenericObservedStateEffect(resolveNativeObservedViewportStateGenericLifecycleEffects({
        effects: [params.effect],
        nextScrollOffsetPx: params.nextScrollOffsetPx,
        pinEnabled: params.pinEnabled,
        sessionId: params.effect.sessionId,
        suppressAnchorCapture: params.suppressAnchorCapture,
    }));
}

describe('native observed viewport-state generic effects', () => {
    it('projects the current-session following native observed state through the generic mapping', () => {
        expect(resolveCurrentSessionObservedState({
            effect: followingObservedEffect(),
            nextScrollOffsetPx: 512.9,
            pinEnabled: true,
            suppressAnchorCapture: true,
        })).toEqual({
            sessionId: 'session-a',
            state: {
                anchorCapture: {
                    suppressAnchorCapture: true,
                    viewportState: {
                        isPinned: false,
                        offsetY: 96,
                        shouldPersistViewport: false,
                        shouldRestoreViewport: false,
                    },
                },
                drain: {
                    distanceFromLiveTailPx: 96,
                    isPinned: false,
                },
                jumpButtonDistanceFromLiveTailPx: 96,
                lastDistanceFromLiveTailPx: 96,
                nextScrollOffsetPx: 512,
                scrollPinEvent: {
                    enabled: true,
                    offsetY: 96,
                    pinnedOffsetThresholdPx: 72,
                    type: 'scroll',
                },
                viewportState: {
                    isPinned: false,
                    offsetY: 96,
                    shouldPersistViewport: false,
                    shouldRestoreViewport: false,
                },
                wantsPinned: true,
            },
            type: 'apply-generic-observed-viewport-state',
        });
    });

    it('derives viewport restore from wantsPinned for released native observed state', () => {
        const effect = resolveCurrentSessionObservedState({
            effect: {
                ...followingObservedEffect(),
                distanceFromLiveTailPx: 180,
                pinnedOffsetThresholdPx: 0,
                // Deliberately opposite to the derived value (!wantsPinned): the mapper
                // must derive restore from follow intent, not copy this field.
                shouldRestoreViewport: false,
                wantsPinned: false,
            },
            nextScrollOffsetPx: 24,
            pinEnabled: false,
            suppressAnchorCapture: false,
        });

        expect(effect.state.viewportState).toEqual({
            isPinned: false,
            offsetY: 180,
            shouldPersistViewport: false,
            shouldRestoreViewport: true,
        });
        expect(effect.state.drain).toEqual({
            distanceFromLiveTailPx: 180,
            isPinned: false,
        });
        expect(effect.state.scrollPinEvent).toMatchObject({
            enabled: false,
            offsetY: 180,
            pinnedOffsetThresholdPx: 0,
        });
        expect(effect.state.wantsPinned).toBe(false);
    });

    it('preserves pinned native observed state without forced anchor suppression', () => {
        const effect = resolveCurrentSessionObservedState({
            effect: {
                ...followingObservedEffect(),
                distanceFromLiveTailPx: 0,
                isPinned: true,
            },
            nextScrollOffsetPx: 0,
            pinEnabled: true,
            suppressAnchorCapture: false,
        });

        expect(effect.state.viewportState).toEqual({
            isPinned: true,
            offsetY: 0,
            shouldPersistViewport: false,
            shouldRestoreViewport: false,
        });
        expect(effect.state.drain).toEqual({
            distanceFromLiveTailPx: 0,
            isPinned: true,
        });
        expect(effect.state.jumpButtonDistanceFromLiveTailPx).toBe(0);
        expect(effect.state.anchorCapture.suppressAnchorCapture).toBe(false);
    });

    it('clamps invalid next scroll offsets to the existing host-safe zero', () => {
        for (const nextScrollOffsetPx of [-12, Number.NaN, Number.POSITIVE_INFINITY]) {
            const effect = resolveCurrentSessionObservedState({
                effect: followingObservedEffect(),
                nextScrollOffsetPx,
                pinEnabled: false,
                suppressAnchorCapture: false,
            });

            expect(effect.state.nextScrollOffsetPx).toBe(0);
        }
    });

    it('filters mixed effects down to the first current-session native observed state', () => {
        const effects = resolveNativeObservedViewportStateGenericLifecycleEffects({
            effects: [
                followingObservedEffect({ sessionId: 'session-b' }),
                {
                    distanceFromLiveTailPx: 120,
                    isPinned: false,
                    sessionId: 'session-a',
                    type: 'native-scroll-release-live-tail',
                },
                followingObservedEffect({ distanceFromLiveTailPx: 132 }),
                followingObservedEffect({ distanceFromLiveTailPx: 180 }),
            ],
            nextScrollOffsetPx: 12,
            pinEnabled: false,
            sessionId: 'session-a',
            suppressAnchorCapture: false,
        });

        expect(firstGenericObservedStateEffect(effects).state.lastDistanceFromLiveTailPx).toBe(132);
    });
});
