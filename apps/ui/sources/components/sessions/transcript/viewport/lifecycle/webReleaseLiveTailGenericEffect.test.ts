import { describe, expect, it } from 'vitest';

import type { TranscriptViewportLifecycleEffect } from './lifecycle';
import { resolveWebReleaseLiveTailGenericEffects } from './webReleaseLiveTailGenericEffect';

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

describe('web release live-tail generic effects', () => {
    it('maps web release effects to generic observed-state effects', () => {
        expect(firstGenericObservedStateEffect(resolveWebReleaseLiveTailGenericEffects({
            effect: {
                distanceFromLiveTailPx: 180,
                isPinned: false,
                sessionId: 'session-a',
                type: 'web-release-live-tail',
            },
            nextScrollOffsetPx: 512,
            pinEnabled: true,
        }))).toEqual({
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

        expect(firstGenericObservedStateEffect(resolveWebReleaseLiveTailGenericEffects({
            effect: {
                distanceFromLiveTailPx: 180,
                isPinned: false,
                sessionId: 'session-a',
                type: 'web-release-live-tail',
            },
            nextScrollOffsetPx: 512,
            pinEnabled: false,
        })).state.scrollPinEvent).toMatchObject({
            enabled: false,
            pinnedOffsetThresholdPx: 0,
        });
    });
});
