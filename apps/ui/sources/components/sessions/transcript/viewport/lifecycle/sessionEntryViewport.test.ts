import { describe, expect, it } from 'vitest';

import type { TranscriptViewportLifecycleEffect } from './lifecycle';
import { resolveSessionEntryViewportApplyEffects } from './sessionEntryViewport';

const sessionEntryViewportEffect = (
    overrides: Partial<Extract<TranscriptViewportLifecycleEffect, { type: 'session-entry-viewport' }>> = {},
): Extract<TranscriptViewportLifecycleEffect, { type: 'session-entry-viewport' }> => ({
    distanceFromLiveTailPx: 0,
    isPinned: true,
    sessionId: 'session-a',
    shouldRestoreViewport: false,
    type: 'session-entry-viewport',
    ...overrides,
});

describe('session-entry viewport apply effects', () => {
    it('maps pinned follow-bottom entry to a typed apply effect', () => {
        expect(resolveSessionEntryViewportApplyEffects({
            effects: [sessionEntryViewportEffect()],
            sessionId: 'session-a',
        })).toEqual([
            {
                distanceFromLiveTailPx: 0,
                isPinned: true,
                jumpButtonDistanceFromLiveTailPx: 0,
                sessionId: 'session-a',
                shouldEmitViewportChange: true,
                shouldRestoreViewport: false,
                shouldUseEntryAnchor: false,
                type: 'apply-session-entry-viewport',
            },
        ]);
    });

    it('preserves unknown restored distance without fabricating a persisted bottom viewport', () => {
        expect(resolveSessionEntryViewportApplyEffects({
            effects: [
                sessionEntryViewportEffect({
                    distanceFromLiveTailPx: null,
                    isPinned: false,
                    shouldRestoreViewport: true,
                }),
            ],
            sessionId: 'session-a',
        })).toEqual([
            {
                distanceFromLiveTailPx: null,
                isPinned: false,
                jumpButtonDistanceFromLiveTailPx: 0,
                sessionId: 'session-a',
                shouldEmitViewportChange: false,
                shouldRestoreViewport: true,
                shouldUseEntryAnchor: true,
                type: 'apply-session-entry-viewport',
            },
        ]);
    });
});
