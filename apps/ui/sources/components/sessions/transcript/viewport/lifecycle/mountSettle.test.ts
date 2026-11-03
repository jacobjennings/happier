import { describe, expect, it } from 'vitest';

import { createTranscriptMountSettlePinCoordinator } from './mountSettle';

const tuning = {
    quiescentWindowMs: 100,
    dimensionNoiseFloorPx: 1,
    bottomDistanceNoiseFloorPx: 2,
} as const;

function observeDoneAt(nowMs: number) {
    return {
        sessionId: 'session-a',
        nowMs,
        initialFillStatus: 'done' as const,
        listContentHeight: 1200,
        listLayoutHeight: 640,
        composerInsetHeight: 220,
        distanceFromBottom: 0,
    };
}

describe('lifecycle mount-settle owner', () => {
    it('waits for initial fill and quiescent metrics before stable settle', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.recordLayoutCommitObserved({ sessionId: 'session-a', nowMs: 10 });

        coordinator.observeMetrics({
            ...observeDoneAt(20),
            initialFillStatus: 'in_progress',
        });
        coordinator.observeMetrics(observeDoneAt(140));
        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        coordinator.observeMetrics({
            ...observeDoneAt(210),
            composerInsetHeight: 240,
        });
        coordinator.observeMetrics({
            ...observeDoneAt(309),
            composerInsetHeight: 240,
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        coordinator.observeMetrics({
            ...observeDoneAt(310),
            composerInsetHeight: 240,
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(true);
    });

    it('does not settle before both readiness events are observed', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.observeMetrics(observeDoneAt(500));

        expect(coordinator.getSnapshot().stableSettle).toBe(false);
    });

    it('does not settle while list dimensions are empty', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.recordLayoutCommitObserved({ sessionId: 'session-a', nowMs: 0 });

        coordinator.observeMetrics({
            ...observeDoneAt(120),
            listContentHeight: 0,
        });
        coordinator.observeMetrics({
            ...observeDoneAt(220),
            listContentHeight: 0,
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        coordinator.observeMetrics({
            ...observeDoneAt(340),
            listContentHeight: 1200,
            listLayoutHeight: 0,
        });
        coordinator.observeMetrics({
            ...observeDoneAt(440),
            listContentHeight: 1200,
            listLayoutHeight: 0,
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        coordinator.observeMetrics(observeDoneAt(560));
        coordinator.observeMetrics(observeDoneAt(660));

        expect(coordinator.getSnapshot().stableSettle).toBe(true);
    });

    it('does not reset quiescence for metrics that only changed within noise floors', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.recordLayoutCommitObserved({ sessionId: 'session-a', nowMs: 0 });
        coordinator.observeMetrics(observeDoneAt(0));
        coordinator.observeMetrics({
            ...observeDoneAt(50),
            listContentHeight: 1200.5,
            distanceFromBottom: 1,
        });
        coordinator.observeMetrics({
            ...observeDoneAt(100),
            listContentHeight: 1200.5,
            distanceFromBottom: 1,
        });

        expect(coordinator.getSnapshot().stableSettle).toBe(true);
    });

    it('graduates stable settle when sampled after a quiescent window without new metrics', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.recordLayoutCommitObserved({ sessionId: 'session-a', nowMs: 0 });
        coordinator.observeMetrics(observeDoneAt(20));

        coordinator.sample({ sessionId: 'session-a', nowMs: 121 });

        expect(coordinator.getSnapshot().stableSettle).toBe(true);

        coordinator.observeMetrics({
            ...observeDoneAt(122),
            distanceFromBottom: 120,
        });

        expect(coordinator.getSnapshot().stableSettle).toBe(true);
    });

    it('does not settle on the same metrics sample that reports a meaningful late layout change', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.recordLayoutCommitObserved({ sessionId: 'session-a', nowMs: 0 });
        coordinator.observeMetrics(observeDoneAt(20));

        coordinator.observeMetrics({
            ...observeDoneAt(140),
            listContentHeight: 1600,
        });

        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        coordinator.observeMetrics({
            ...observeDoneAt(239),
            listContentHeight: 1600,
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        coordinator.observeMetrics({
            ...observeDoneAt(240),
            listContentHeight: 1600,
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(true);
    });

    it('resets readiness when the session changes', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.recordLayoutCommitObserved({ sessionId: 'session-a', nowMs: 0 });
        coordinator.observeMetrics(observeDoneAt(100));
        expect(coordinator.getSnapshot().stableSettle).toBe(true);

        coordinator.observeMetrics({
            ...observeDoneAt(110),
            sessionId: 'session-b',
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        // session-b has not painted or committed layout yet, so a full quiet window alone must not settle it.
        coordinator.observeMetrics({
            ...observeDoneAt(400),
            sessionId: 'session-b',
        });
        expect(coordinator.getSnapshot().stableSettle).toBe(false);
        expect(coordinator.nextSettleCheckDelayMs(400)).toBeNull();
    });

    it('resets readiness when unmounted', () => {
        const coordinator = createTranscriptMountSettlePinCoordinator({ tuning });
        coordinator.recordFirstListPaint({ sessionId: 'session-a', nowMs: 0 });
        coordinator.recordLayoutCommitObserved({ sessionId: 'session-a', nowMs: 0 });
        coordinator.observeMetrics(observeDoneAt(100));

        expect(coordinator.getSnapshot().stableSettle).toBe(true);

        coordinator.reset({ reason: 'unmount' });
        expect(coordinator.getSnapshot().stableSettle).toBe(false);

        // After remount the same session must paint and commit layout again before it can settle.
        coordinator.observeMetrics(observeDoneAt(400));
        expect(coordinator.getSnapshot().stableSettle).toBe(false);
        expect(coordinator.nextSettleCheckDelayMs(400)).toBeNull();
    });

});
