import { afterEach, describe, expect, it } from 'vitest';
import {
    createSyncReliabilityTelemetry,
    installSyncReliabilityTelemetryGlobal,
} from './syncReliabilityTelemetry';
import type { PersistedSyncReliabilityEvent } from '@/sync/domains/state/persistence';

describe('sync reliability telemetry', () => {
    afterEach(() => {
        delete (globalThis as { __HAPPIER_SYNC_RELIABILITY__?: unknown }).__HAPPIER_SYNC_RELIABILITY__;
    });

    it('records in-memory events and persists critical events through the storage boundary', () => {
        const persisted: PersistedSyncReliabilityEvent[] = [];
        const telemetry = createSyncReliabilityTelemetry({
            now: () => 123,
            randomId: () => 'id-1',
            storage: {
                appendEvent: (event) => {
                    persisted.push(event);
                },
                loadEvents: () => persisted,
            },
        });

        telemetry.record('sync.cursor.advance', { cursor: '10' });
        telemetry.recordCritical('sync.cursor.refused', { cursor: '11', blockedReason: 'unsupported-kind' });

        expect(telemetry.snapshot()).toEqual({
            events: [
                { id: 'id-1', name: 'sync.cursor.advance', atMs: 123, fields: { cursor: '10' } },
                { id: 'id-1', name: 'sync.cursor.refused', atMs: 123, fields: { cursor: '11', blockedReason: 'unsupported-kind' } },
            ],
            persistedEvents: [
                { id: 'id-1', name: 'sync.cursor.refused', atMs: 123, fields: { cursor: '11', blockedReason: 'unsupported-kind' } },
            ],
        });
        expect(persisted).toEqual([
            { id: 'id-1', name: 'sync.cursor.refused', atMs: 123, fields: { cursor: '11', blockedReason: 'unsupported-kind' } },
        ]);
    });

    it('exposes a global QA snapshot bounded by maxMemoryEvents', () => {
        let nextId = 0;
        const telemetry = createSyncReliabilityTelemetry({
            now: () => 1,
            randomId: () => `id-${++nextId}`,
            maxMemoryEvents: 2,
            storage: {
                appendEvent: () => {},
                loadEvents: () => [],
            },
        });

        installSyncReliabilityTelemetryGlobal(telemetry);
        telemetry.record('sync.snapshot.first');
        telemetry.record('sync.snapshot.second');
        telemetry.record('sync.snapshot.third');

        const globalApi = (globalThis as unknown as {
            __HAPPIER_SYNC_RELIABILITY__?: { snapshot: () => unknown; reset: () => void };
        }).__HAPPIER_SYNC_RELIABILITY__;

        expect(globalApi?.snapshot()).toEqual({
            events: [
                { id: 'id-2', name: 'sync.snapshot.second', atMs: 1, fields: {} },
                { id: 'id-3', name: 'sync.snapshot.third', atMs: 1, fields: {} },
            ],
            persistedEvents: [],
        });
        globalApi?.reset();
        expect(telemetry.snapshot().events).toEqual([]);
    });
});
