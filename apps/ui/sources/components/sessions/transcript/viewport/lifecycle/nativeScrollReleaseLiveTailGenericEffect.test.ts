import { describe, expect, it } from 'vitest';

import type { TranscriptViewportLifecycleEffect } from './lifecycle';
import {
    resolveNativeScrollReleaseLiveTailGenericLifecycleEffects,
} from './nativeScrollReleaseLiveTailGenericEffect';

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

type NativeScrollReleaseLiveTailEffect = Extract<
    TranscriptViewportLifecycleEffect,
    { type: 'native-scroll-release-live-tail' }
>;

const releaseEffect = (
    overrides: Partial<NativeScrollReleaseLiveTailEffect> = {},
): NativeScrollReleaseLiveTailEffect => ({
    distanceFromLiveTailPx: 180,
    isPinned: false,
    sessionId: 'session-a',
    type: 'native-scroll-release-live-tail',
    ...overrides,
});

function resolveCurrentSessionRelease(params: Readonly<{
    effect: NativeScrollReleaseLiveTailEffect;
    nextScrollOffsetPx: number;
    pinEnabled: boolean;
}>) {
    return firstGenericObservedStateEffect(resolveNativeScrollReleaseLiveTailGenericLifecycleEffects({
        effects: [params.effect],
        nextScrollOffsetPx: params.nextScrollOffsetPx,
        pinEnabled: params.pinEnabled,
        sessionId: params.effect.sessionId,
    }));
}

describe('native scroll release live-tail generic effects', () => {
    it('projects the current-session native scroll release through the generic release mapping', () => {
        expect(resolveCurrentSessionRelease({
            effect: releaseEffect(),
            nextScrollOffsetPx: 512.9,
            pinEnabled: true,
        })).toEqual({
            sessionId: 'session-a',
            state: {
                anchorCapture: {
                    suppressAnchorCapture: false,
                    viewportState: {
                        isPinned: false,
                        offsetY: 180,
                        shouldPersistViewport: false,
                        shouldRestoreViewport: true,
                    },
                },
                drain: {
                    distanceFromLiveTailPx: 180,
                    isPinned: false,
                },
                jumpButtonDistanceFromLiveTailPx: 180,
                lastDistanceFromLiveTailPx: 180,
                nextScrollOffsetPx: 512,
                scrollPinEvent: {
                    enabled: true,
                    offsetY: 180,
                    pinnedOffsetThresholdPx: 0,
                    type: 'scroll',
                },
                viewportState: {
                    isPinned: false,
                    offsetY: 180,
                    shouldPersistViewport: false,
                    shouldRestoreViewport: true,
                },
                wantsPinned: false,
            },
            type: 'apply-generic-observed-viewport-state',
        });
    });

    it('clamps invalid next scroll offsets to the existing host-safe zero', () => {
        for (const nextScrollOffsetPx of [-12, Number.NaN, Number.POSITIVE_INFINITY]) {
            const effect = resolveCurrentSessionRelease({
                effect: releaseEffect(),
                nextScrollOffsetPx,
                pinEnabled: false,
            });

            expect(effect.state.nextScrollOffsetPx).toBe(0);
        }
    });

    it('uses the lifecycle-provided release distance without adding mapper normalization', () => {
        const effect = resolveCurrentSessionRelease({
            effect: {
                ...releaseEffect(),
                distanceFromLiveTailPx: 0.5,
            },
            nextScrollOffsetPx: 24,
            pinEnabled: false,
        });

        expect(effect.state.viewportState).toEqual({
            isPinned: false,
            offsetY: 0.5,
            shouldPersistViewport: false,
            shouldRestoreViewport: true,
        });
        expect(effect.state.lastDistanceFromLiveTailPx).toBe(0.5);
        expect(effect.state.scrollPinEvent).toMatchObject({
            enabled: false,
            offsetY: 0.5,
            pinnedOffsetThresholdPx: 0,
        });
    });

    it('filters mixed effects down to the first current-session native scroll release', () => {
        const effects = resolveNativeScrollReleaseLiveTailGenericLifecycleEffects({
            effects: [
                releaseEffect({ sessionId: 'session-b' }),
                {
                    distanceFromLiveTailPx: 22,
                    isPinned: true,
                    pinnedOffsetThresholdPx: 72,
                    sessionId: 'session-a',
                    shouldRestoreViewport: true,
                    type: 'native-observed-viewport-state',
                    wantsPinned: true,
                },
                releaseEffect({ distanceFromLiveTailPx: 96 }),
                releaseEffect({ distanceFromLiveTailPx: 120 }),
            ],
            nextScrollOffsetPx: 12,
            pinEnabled: false,
            sessionId: 'session-a',
        });

        expect(firstGenericObservedStateEffect(effects).state.lastDistanceFromLiveTailPx).toBe(96);
    });
});
