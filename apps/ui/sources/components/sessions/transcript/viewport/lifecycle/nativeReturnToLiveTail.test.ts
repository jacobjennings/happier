import { describe, expect, it } from 'vitest';

import type { TranscriptViewportLifecycleEffect } from './lifecycle';
import {
    resolveNativeReturnToLiveTailApplyEffects,
    resolveNativeSettledReturnToLiveTailApplyEffects,
} from './nativeReturnToLiveTail';

const viewportChangeEffect: Extract<TranscriptViewportLifecycleEffect, { type: 'viewport-change' }> = {
    distanceFromLiveTailPx: 0,
    isPinned: true,
    sessionId: 'session-a',
    source: 'explicit-return',
    type: 'viewport-change',
};

const drainEffect: Extract<TranscriptViewportLifecycleEffect, { type: 'drain-deferred-newer' }> = {
    distanceFromLiveTailPx: 0,
    isPinned: true,
    sessionId: 'session-a',
    type: 'drain-deferred-newer',
};

describe('native return-to-live-tail apply effect selector', () => {
    it('preserves current-session matching effect order and multiplicity while ignoring unrelated effects', () => {
        expect(resolveNativeReturnToLiveTailApplyEffects({
            effects: [
                { ...drainEffect, distanceFromLiveTailPx: 40, sessionId: 'session-b' },
                { ...viewportChangeEffect, distanceFromLiveTailPx: 50, sessionId: 'session-b' },
                {
                    reason: 'jump-to-bottom',
                    sessionId: 'session-a',
                    type: 'explicit-jump-preempt-entry-restore',
                },
                { ...drainEffect, distanceFromLiveTailPx: 24, isPinned: true },
                { ...viewportChangeEffect, distanceFromLiveTailPx: 2 },
                { ...drainEffect, distanceFromLiveTailPx: 3 },
                { ...viewportChangeEffect, distanceFromLiveTailPx: 1 },
            ],
            sessionId: 'session-a',
        })).toEqual([
            {
                distanceFromLiveTailPx: 24,
                isPinned: true,
                sessionId: 'session-a',
                type: 'drain-native-return-to-live-tail',
            },
            {
                distanceFromLiveTailPx: 2,
                sessionId: 'session-a',
                type: 'adopt-native-return-to-live-tail',
            },
            {
                distanceFromLiveTailPx: 3,
                isPinned: true,
                sessionId: 'session-a',
                type: 'drain-native-return-to-live-tail',
            },
            {
                distanceFromLiveTailPx: 1,
                sessionId: 'session-a',
                type: 'adopt-native-return-to-live-tail',
            },
        ]);
    });
});

describe('native settled return-to-live-tail apply effect selector', () => {
    it('preserves settled return order and drain order without interleaving drains before paint', () => {
        expect(resolveNativeSettledReturnToLiveTailApplyEffects({
            effects: [
                { ...drainEffect, distanceFromLiveTailPx: 40, sessionId: 'session-b' },
                { ...viewportChangeEffect, distanceFromLiveTailPx: 50, sessionId: 'session-b' },
                { ...drainEffect, distanceFromLiveTailPx: 24 },
                { ...viewportChangeEffect, distanceFromLiveTailPx: 2 },
                { ...drainEffect, distanceFromLiveTailPx: 3 },
                { ...viewportChangeEffect, distanceFromLiveTailPx: 1 },
            ],
            sessionId: 'session-a',
        })).toEqual({
            drainEffects: [
                {
                    distanceFromLiveTailPx: 24,
                    isPinned: true,
                    sessionId: 'session-a',
                    type: 'drain-native-settled-return-to-live-tail',
                },
                {
                    distanceFromLiveTailPx: 3,
                    isPinned: true,
                    sessionId: 'session-a',
                    type: 'drain-native-settled-return-to-live-tail',
                },
            ],
            returnEffects: [
                {
                    distanceFromLiveTailPx: 2,
                    sessionId: 'session-a',
                    type: 'adopt-native-settled-return-to-live-tail',
                },
                {
                    sessionId: 'session-a',
                    type: 'capture-native-settled-return-anchor',
                    viewportState: {
                        isPinned: true,
                        offsetY: 0,
                        shouldRestoreViewport: false,
                    },
                },
                {
                    distanceFromLiveTailPx: 1,
                    sessionId: 'session-a',
                    type: 'adopt-native-settled-return-to-live-tail',
                },
                {
                    sessionId: 'session-a',
                    type: 'capture-native-settled-return-anchor',
                    viewportState: {
                        isPinned: true,
                        offsetY: 0,
                        shouldRestoreViewport: false,
                    },
                },
            ],
        });
    });

    it('keeps drain-only input separate so callers can require a consumed settled return first', () => {
        expect(resolveNativeSettledReturnToLiveTailApplyEffects({
            effects: [
                { ...drainEffect, distanceFromLiveTailPx: 5 },
                { ...drainEffect, distanceFromLiveTailPx: 6 },
            ],
            sessionId: 'session-a',
        })).toEqual({
            drainEffects: [
                {
                    distanceFromLiveTailPx: 5,
                    isPinned: true,
                    sessionId: 'session-a',
                    type: 'drain-native-settled-return-to-live-tail',
                },
                {
                    distanceFromLiveTailPx: 6,
                    isPinned: true,
                    sessionId: 'session-a',
                    type: 'drain-native-settled-return-to-live-tail',
                },
            ],
            returnEffects: [],
        });
    });
});
