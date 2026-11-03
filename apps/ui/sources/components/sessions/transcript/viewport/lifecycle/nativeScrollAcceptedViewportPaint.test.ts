import { describe, expect, it } from 'vitest';

import {
    resolveNativeScrollAcceptedViewportPaintObservationEffects,
} from './nativeScrollAcceptedViewportPaint';

type AcceptedViewportPaintObservation = Parameters<typeof resolveNativeScrollAcceptedViewportPaintObservationEffects>[0];

describe('native scroll accepted viewport paint decision', () => {
    const baseObservation = {
        distanceFromLiveTailPx: 0,
        entryRestoreConfirmedByObservation: false,
        fallbackMetrics: {
            contentHeight: 42.8,
            distanceFromLiveTailPx: -3.4,
            layoutHeight: 17.9,
        },
        hasRenderedItems: true,
        isLoaded: true,
        isTrusted: false,
        isWarmKeepAliveInstance: false,
        nativeMountSettleDeadlineReached: false,
        nativeMountSettleStable: false,
        sessionEntryShouldFollowBottom: undefined,
        sessionId: 'session-a',
        thresholdPx: 72,
        wantsPinned: true,
    };

    const acceptedPaintEffects = [{
        fallbackMetrics: {
            contentHeight: 42,
            distanceFromLiveTailPx: 0,
            layoutHeight: 17,
        },
        sessionId: 'session-a',
        type: 'record-accepted-viewport-paint',
    }];

    function resolvePaint(overrides: Partial<AcceptedViewportPaintObservation> = {}) {
        return resolveNativeScrollAcceptedViewportPaintObservationEffects({
            ...baseObservation,
            ...overrides,
        });
    }

    // Contract change (2026-07-28, ported from remote-dev W7/A-fix). This case previously asserted
    // that reaching the live-tail threshold is sufficient to release the first accepted paint. That
    // makes the reveal edge unconditional on every native open: the transcript paints wherever the
    // list currently is and then moves once native placement settles, which is the cold-open
    // flicker. The reveal edge on native is settle-stable, the mount-settle deadline, or the warm
    // keep-alive allowance — never an unconditional accept. The whole point of the port: the same
    // observation with no settle fact is NOT a reveal.
    it('creates no accepted paint observation effects at the live tail before mount settle', () => {
        expect(resolvePaint({ distanceFromLiveTailPx: 72 })).toEqual([]);
    });

    it('blocks follow-bottom paint release when the observation is beyond the threshold', () => {
        expect(resolvePaint({ distanceFromLiveTailPx: 73, nativeMountSettleStable: true })).toEqual([]);
        expect(resolvePaint({ distanceFromLiveTailPx: 73, nativeMountSettleDeadlineReached: true })).toEqual([]);
        expect(resolvePaint({ distanceFromLiveTailPx: 73, isWarmKeepAliveInstance: true })).toEqual([]);
    });

    it('allows native paint release only after mount-settle stability or deadline', () => {
        expect(resolvePaint({ nativeMountSettleStable: true })).toEqual(acceptedPaintEffects);
        expect(resolvePaint({ nativeMountSettleDeadlineReached: true })).toEqual(acceptedPaintEffects);
        expect(resolvePaint()).toEqual([]);
    });

    // Blank-screen guard. A settle signal that never stabilizes must not withhold the reveal: the
    // deadline is the second, independent release edge, and its producer
    // (`useTranscriptNativeMountSettleLifecycle`) always reaches it within
    // `transcriptInitialFillBudgetMs + transcriptMountSettleQuiescentWindowMs`. This gate may delay
    // a reveal; it must never be able to hang one.
    it('releases paint on the mount-settle deadline when stability never arrives', () => {
        expect(resolvePaint({
            isWarmKeepAliveInstance: false,
            nativeMountSettleDeadlineReached: true,
            nativeMountSettleStable: false,
            sessionEntryShouldFollowBottom: false,
        })).toEqual(acceptedPaintEffects);
    });

    it('preserves the warm keep-alive follow-bottom bypass', () => {
        expect(resolvePaint({
            isWarmKeepAliveInstance: true,
            sessionEntryShouldFollowBottom: true,
        })).toEqual(acceptedPaintEffects);
        expect(resolvePaint({
            isWarmKeepAliveInstance: true,
            sessionEntryShouldFollowBottom: undefined,
        })).toEqual(acceptedPaintEffects);
        expect(resolvePaint({
            isWarmKeepAliveInstance: true,
            sessionEntryShouldFollowBottom: false,
        })).toEqual([]);
    });

    it.each([
        { case: 'the transcript is not loaded', overrides: { isLoaded: false } },
        { case: 'the list has no rendered items', overrides: { hasRenderedItems: false } },
        { case: 'the observation is trusted', overrides: { isTrusted: true } },
    ])('creates no accepted paint effects when $case, even once mount settle is stable', ({ overrides }) => {
        expect(resolvePaint({ ...overrides, nativeMountSettleStable: true })).toEqual([]);
    });

    it('creates no accepted paint effects for an unpinned reader still inside the threshold', () => {
        expect(resolvePaint({ distanceFromLiveTailPx: 72, wantsPinned: false })).toEqual([]);
    });

    it('creates accepted paint observation effects once mount settle is stable', () => {
        expect(resolvePaint({
            distanceFromLiveTailPx: 72,
            nativeMountSettleStable: true,
        })).toEqual(acceptedPaintEffects);
    });

    it('accepts observation effects from entry-restore confirmation even when follow-bottom readiness is false', () => {
        expect(resolvePaint({
            entryRestoreConfirmedByObservation: true,
        })).toEqual(acceptedPaintEffects);
    });

    it('accepts observation effects from unpinned distance beyond threshold', () => {
        expect(resolvePaint({
            distanceFromLiveTailPx: 91,
            fallbackMetrics: {
                contentHeight: 42,
                distanceFromLiveTailPx: 91,
                layoutHeight: 17,
            },
            wantsPinned: false,
        })).toEqual([{
            fallbackMetrics: {
                contentHeight: 42,
                distanceFromLiveTailPx: 91,
                layoutHeight: 17,
            },
            sessionId: 'session-a',
            type: 'record-accepted-viewport-paint',
        }]);
    });
});
