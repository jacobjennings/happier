import { describe, expect, it } from 'vitest';

import {
    resolveNativePrependCloseEffects,
    type NativePrependCloseSnapshot,
} from './prependCloseEffects';

const baseSnapshot: NativePrependCloseSnapshot = {
    activeOwnerIsPrepend: true,
    anchorDeltaPx: -80,
    anchorItemOffsetPx: 240,
    correctorCoverage: {
        appliedDiffTotalPx: -80,
        eventCount: 2,
    },
    outcome: 'fallback-restored',
    sessionId: 'session-1',
};

describe('prepend close effects', () => {
    it('closes active prepend ownership and records fallback-restored telemetry', () => {
        expect(resolveNativePrependCloseEffects(baseSnapshot)).toEqual([
            {
                outcome: 'fallback-restored',
                type: 'close-prepend-ownership',
            },
            {
                anchorDeltaPx: -80,
                anchorItemOffsetPx: 240,
                correctorAppliedDiffTotalPx: -80,
                correctorEventCount: 2,
                mode: 'restore-anchor',
                reason: 'fallback-restored',
                sessionId: 'session-1',
                type: 'restore-decision-for-session',
            },
        ]);
    });

    it('records abandoned outcomes without fabricating a missing anchor delta', () => {
        for (const outcome of [
            'abandoned-user-scroll',
            'abandoned-identity',
            'abandoned-layout-timeout',
        ] as const) {
            expect(resolveNativePrependCloseEffects({
                ...baseSnapshot,
                anchorDeltaPx: null,
                correctorCoverage: {
                    appliedDiffTotalPx: 16,
                    eventCount: 1,
                },
                outcome,
            })).toEqual([
                {
                    outcome,
                    type: 'close-prepend-ownership',
                },
                {
                    anchorItemOffsetPx: 240,
                    correctorAppliedDiffTotalPx: 16,
                    correctorEventCount: 1,
                    mode: 'restore-anchor',
                    reason: outcome,
                    sessionId: 'session-1',
                    type: 'restore-decision-for-session',
                },
            ]);
        }
    });

    it('does not close ownership when prepend is no longer the active owner', () => {
        expect(resolveNativePrependCloseEffects({
            ...baseSnapshot,
            activeOwnerIsPrepend: false,
        })).toEqual([
            {
                anchorDeltaPx: -80,
                anchorItemOffsetPx: 240,
                correctorAppliedDiffTotalPx: -80,
                correctorEventCount: 2,
                mode: 'restore-anchor',
                reason: 'fallback-restored',
                sessionId: 'session-1',
                type: 'restore-decision-for-session',
            },
        ]);
    });
});
