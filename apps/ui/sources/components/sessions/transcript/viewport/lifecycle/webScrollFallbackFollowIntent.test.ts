import { describe, expect, it } from 'vitest';

import { resolveActiveWebScrollFallbackObservationEffects } from './webScrollFallbackFollowIntent';
import type { TranscriptViewportLifecycleEffect } from './lifecycle';

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

describe('web scroll fallback follow intent', () => {
    const baseParams = {
        distanceFromLiveTailPx: 96,
        pinEnabled: true,
        pinThresholdPx: 72,
        previousScrollOffset: 120,
        recentUserIntent: true,
        scrollOffset: 80,
        wantsPinned: true,
    };
    const sessionId = 'session-a';

    function resolveFallbackEffects(overrides: Partial<typeof baseParams> = {}) {
        return resolveActiveWebScrollFallbackObservationEffects({
            ...baseParams,
            sessionId,
            ...overrides,
        });
    }

    it('releases on recent user intent plus movement away and cancels scheduled anchor capture', () => {
        expect(resolveFallbackEffects()).toEqual([
            {
                sessionId,
                state: {
                    anchorCapture: {
                        suppressAnchorCapture: true,
                        viewportState: {
                            isPinned: false,
                            offsetY: 96,
                            shouldPersistViewport: false,
                            shouldRestoreViewport: true,
                        },
                    },
                    drain: {
                        distanceFromLiveTailPx: 96,
                        isPinned: false,
                    },
                    jumpButtonDistanceFromLiveTailPx: 96,
                    lastDistanceFromLiveTailPx: 96,
                    nextScrollOffsetPx: 80,
                    scrollPinEvent: {
                        enabled: true,
                        offsetY: 96,
                        pinnedOffsetThresholdPx: 0,
                        type: 'scroll',
                    },
                    viewportState: {
                        isPinned: false,
                        offsetY: 96,
                        shouldPersistViewport: false,
                        shouldRestoreViewport: true,
                    },
                    wantsPinned: false,
                },
                type: 'apply-generic-observed-viewport-state',
            },
            {
                reason: 'web-no-live-metrics-fallback-release',
                sessionId,
                type: 'cancel-scheduled-viewport-anchor-capture',
            },
        ]);
    });

    it('keeps a steady reader pinned-wanting and anchor capture live without recent user intent', () => {
        const effects = resolveFallbackEffects({
            pinEnabled: false,
            recentUserIntent: false,
        });

        expect(effects).toHaveLength(1);
        expect(firstGenericObservedStateEffect(effects).state).toMatchObject({
            anchorCapture: {
                suppressAnchorCapture: false,
            },
            scrollPinEvent: {
                enabled: false,
                pinnedOffsetThresholdPx: 72,
            },
            viewportState: {
                isPinned: false,
                shouldPersistViewport: false,
                shouldRestoreViewport: false,
            },
            wantsPinned: true,
        });
    });

    it('rearms a released reader at or near the live tail', () => {
        const effects = resolveFallbackEffects({
            distanceFromLiveTailPx: 24,
            previousScrollOffset: 80,
            scrollOffset: 120,
            wantsPinned: false,
        });

        expect(effects).toHaveLength(1);
        expect(firstGenericObservedStateEffect(effects).state).toMatchObject({
            anchorCapture: {
                suppressAnchorCapture: false,
            },
            drain: {
                distanceFromLiveTailPx: 24,
                isPinned: true,
            },
            scrollPinEvent: {
                enabled: true,
                pinnedOffsetThresholdPx: 72,
            },
            viewportState: {
                isPinned: true,
                offsetY: 24,
                shouldPersistViewport: false,
                shouldRestoreViewport: false,
            },
            wantsPinned: true,
        });
    });
});
