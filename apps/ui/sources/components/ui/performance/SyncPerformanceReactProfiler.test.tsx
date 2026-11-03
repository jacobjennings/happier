import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';
import { recordReactProfilerRenderTelemetry, SyncPerformanceReactProfiler } from './SyncPerformanceReactProfiler';

describe('recordReactProfilerRenderTelemetry', () => {
    afterEach(() => {
        syncPerformanceTelemetry.configure({ enabled: false });
        syncPerformanceTelemetry.reset();
    });

    it('records a namespaced render duration for enabled sync performance telemetry', () => {
        syncPerformanceTelemetry.configure({ enabled: true, slowThresholdMs: 1, flushIntervalMs: 30_000 });
        syncPerformanceTelemetry.reset();

        recordReactProfilerRenderTelemetry({
            id: 'sessions.list',
            phase: 'update',
            actualDuration: 12.5,
            baseDuration: 20,
            startTime: 100,
            commitTime: 118,
        });

        expect(syncPerformanceTelemetry.snapshot().events).toEqual([
            expect.objectContaining({
                name: 'ui.react.render.sessions.list',
                count: 1,
                totalMs: 12.5,
                fields: expect.objectContaining({
                    actualDurationMs: 12.5,
                    baseDurationMs: 20,
                    commitLagMs: 18,
                    mount: 0,
                    update: 1,
                }),
            }),
        ]);
    });
});

describe('SyncPerformanceReactProfiler', () => {
    afterEach(() => {
        syncPerformanceTelemetry.configure({ enabled: false });
        syncPerformanceTelemetry.reset();
    });

    it('records one namespaced render event per commit for enabled sync performance telemetry', async () => {
        syncPerformanceTelemetry.configure({ enabled: true, slowThresholdMs: 1, flushIntervalMs: 30_000 });
        syncPerformanceTelemetry.reset();
        let bump: (() => void) | null = null;
        function Counter() {
            const [count, setCount] = React.useState(0);
            bump = () => setCount((value) => value + 1);
            return <>{count}</>;
        }

        await renderScreen(
            <SyncPerformanceReactProfiler id=" sessions list ">
                <Counter />
            </SyncPerformanceReactProfiler>,
        );
        expect(syncPerformanceTelemetry.snapshot().events).toEqual([
            expect.objectContaining({
                name: 'ui.react.render.sessions.list',
                count: 1,
                fields: expect.objectContaining({ mount: 1, update: 0, nestedUpdate: 0 }),
            }),
        ]);

        await act(async () => { bump?.(); });

        const [event] = syncPerformanceTelemetry.snapshot().events;
        expect(syncPerformanceTelemetry.snapshot().events).toHaveLength(1);
        expect(event).toEqual(expect.objectContaining({
            name: 'ui.react.render.sessions.list',
            count: 2,
            // Event fields accumulate per name: one mount commit plus one update commit.
            fields: expect.objectContaining({ mount: 1, update: 1, nestedUpdate: 0 }),
        }));
        expect(event?.fields?.actualDurationMs).toBeGreaterThanOrEqual(0);
        expect(event?.fields?.baseDurationMs).toBeGreaterThanOrEqual(0);
        expect(event?.fields?.commitLagMs).toBeGreaterThanOrEqual(0);
    });

    it('records nothing while sync performance telemetry is disabled', async () => {
        syncPerformanceTelemetry.configure({ enabled: false });
        syncPerformanceTelemetry.reset();

        await renderScreen(
            <SyncPerformanceReactProfiler id="sessions.list">
                <>idle</>
            </SyncPerformanceReactProfiler>,
        );

        expect(syncPerformanceTelemetry.snapshot().events).toEqual([]);
    });
});
