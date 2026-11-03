import { describe, expect, it } from 'vitest';

import {
    resolveGenericScrollObservationReadOnlyVisibleBottomEffects,
    resolveGenericScrollObservationReadOnlyVisibleBottomState,
    resolveGenericScrollObservationViewportState,
    resolveGenericScrollObservationViewportStateEffects,
    type GenericScrollObservationReadOnlyVisibleBottomParams,
    type GenericScrollObservationReadOnlyVisibleBottomState,
    type GenericScrollObservationViewportState,
    type GenericScrollObservationViewportStateParams,
} from './genericScrollObservationViewportState';

describe('generic scroll observation viewport state', () => {
    // The anchor-capture viewport state is the same object as `viewportState` (owner :90-120); its type
    // only names the fields anchor capture reads, so the shared value is bound once and reused.
    const unpinnedViewportState = {
        isPinned: false,
        offsetY: 12.8,
        shouldPersistViewport: false,
        shouldRestoreViewport: true,
    } as const;
    const pinnedViewportState = {
        isPinned: true,
        offsetY: 0,
        shouldPersistViewport: false,
        shouldRestoreViewport: false,
    } as const;

    it.each<{
        expected: GenericScrollObservationViewportState;
        name: string;
        params: GenericScrollObservationViewportStateParams;
    }>([
        {
            expected: {
                anchorCapture: {
                    suppressAnchorCapture: true,
                    viewportState: unpinnedViewportState,
                },
                drain: {
                    distanceFromLiveTailPx: 12.8,
                    isPinned: false,
                },
                jumpButtonDistanceFromLiveTailPx: 12.8,
                lastDistanceFromLiveTailPx: 12,
                nextScrollOffsetPx: 188,
                scrollPinEvent: {
                    enabled: true,
                    offsetY: 12.8,
                    pinnedOffsetThresholdPx: 0,
                    type: 'scroll',
                },
                viewportState: unpinnedViewportState,
                wantsPinned: false,
            },
            name: 'unpinned generic observed viewport state',
            params: {
                followIntentIsPinned: false,
                followIntentNextDistanceFromLiveTailPx: 12,
                followIntentNextScrollOffsetPx: 188,
                followIntentWantsPinned: false,
                pinEnabled: true,
                pinnedOffsetThresholdPx: 0,
                suppressAnchorCapture: true,
                viewportDistanceFromLiveTailPx: 12.8,
            },
        },
        {
            expected: {
                anchorCapture: {
                    suppressAnchorCapture: false,
                    viewportState: pinnedViewportState,
                },
                drain: {
                    distanceFromLiveTailPx: 0,
                    isPinned: true,
                },
                jumpButtonDistanceFromLiveTailPx: 0,
                lastDistanceFromLiveTailPx: 0,
                nextScrollOffsetPx: 0,
                scrollPinEvent: {
                    enabled: true,
                    offsetY: 0,
                    pinnedOffsetThresholdPx: 72,
                    type: 'scroll',
                },
                viewportState: pinnedViewportState,
                wantsPinned: true,
            },
            name: 'pinned live-tail observations',
            params: {
                followIntentIsPinned: true,
                followIntentNextDistanceFromLiveTailPx: 0,
                followIntentNextScrollOffsetPx: 0,
                followIntentWantsPinned: true,
                pinEnabled: true,
                pinnedOffsetThresholdPx: 72,
                suppressAnchorCapture: false,
                viewportDistanceFromLiveTailPx: 0,
            },
        },
    ])('packages $name as state and as one session-scoped effect', ({ expected, params }) => {
        expect(resolveGenericScrollObservationViewportState(params)).toEqual(expected);
        expect(resolveGenericScrollObservationViewportStateEffects({
            ...params,
            sessionId: 'session-a',
        })).toEqual([{
            sessionId: 'session-a',
            state: expected,
            type: 'apply-generic-observed-viewport-state',
        }]);
    });

    it.each<{
        expected: GenericScrollObservationReadOnlyVisibleBottomState;
        name: string;
        params: GenericScrollObservationReadOnlyVisibleBottomParams;
    }>([
        {
            expected: {
                jumpButtonDistanceFromLiveTailPx: 0,
                lastDistanceFromLiveTailPx: 0,
                scrollPinEvent: {
                    enabled: true,
                    offsetY: 0,
                    pinnedOffsetThresholdPx: 72,
                    type: 'scroll',
                },
            },
            name: 'read-only visible-bottom state without viewport persistence fields',
            params: {
                distanceFromLiveTailPx: 0,
                pinEnabled: true,
                pinnedOffsetThresholdPx: 72,
            },
        },
        {
            expected: {
                jumpButtonDistanceFromLiveTailPx: 3.5,
                lastDistanceFromLiveTailPx: 3.5,
                scrollPinEvent: {
                    enabled: false,
                    offsetY: 3.5,
                    pinnedOffsetThresholdPx: 72,
                    type: 'scroll',
                },
            },
            name: 'fractional read-only visible-bottom distances',
            params: {
                distanceFromLiveTailPx: 3.5,
                pinEnabled: false,
                pinnedOffsetThresholdPx: 72,
            },
        },
    ])('packages $name as state and as one session-scoped effect', ({ expected, params }) => {
        expect(resolveGenericScrollObservationReadOnlyVisibleBottomState(params)).toEqual(expected);
        expect(resolveGenericScrollObservationReadOnlyVisibleBottomEffects({
            ...params,
            sessionId: 'session-a',
        })).toEqual([{
            sessionId: 'session-a',
            state: expected,
            type: 'apply-generic-read-only-visible-bottom-state',
        }]);
    });
});
