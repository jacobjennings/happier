import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createProjectAccountRowCipherV1 } from '@happier-dev/protocol/projects/projectAccountRowCipherV1';
import { buildProjectAccountRowPhysicalKeyV1, ProjectAccountRowChangeHintV1Schema, type ProjectAccountRowV1 } from '@happier-dev/protocol/projects/projectAccountRowsV1';
import type { ApiChangeEntry } from '@/sync/api/types/apiTypes';
import { createProjectAccountRowsSync, type ProjectAccountRowsTransport } from '@/sync/engine/projects/projectAccountRowsSync';
import { createProjectAccountRowsDomain, type ProjectAccountRowsDomain } from '@/sync/store/domains/projectAccountRows';
import { applyPlannedChangeActions } from './changesApplier';
import { planSyncActionsFromChanges } from './changesPlanner';

const scope = { serverId: 'home', accountId: 'account' };
const key = { kind: 'workspace-ref' as const, serverId: 'home', id: 'ref' };
const physicalKey = buildProjectAccountRowPhysicalKeyV1(key);

function hintChange(hint: unknown = { projectAccountRow: true, key, revision: 1 }, entityId = physicalKey): ApiChangeEntry {
    return { cursor: 7, changedAt: 1, kind: 'account', entityId, hint };
}

function applyBase(planned: ReturnType<typeof planSyncActionsFromChanges>, refreshed: string[] = []) {
    return {
        planned, credentials: { token: 'token' }, isSessionMessagesLoaded: () => false,
        invalidate: { settings: async () => { refreshed.push('settings'); }, profile: async () => { refreshed.push('profile'); } },
        invalidateMessagesForSession: async () => {}, invalidateScmStatusForSession: () => {},
        applyTodoSocketUpdates: async () => {}, kvBulkGet: async () => ({ values: [] }),
    };
}

describe('Project Account row durable changes', () => {
    it('retains a failed census through recency pushes and recovers only after materializing the row change', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
        onTestFinished(() => { clock.mockRestore(); });
        const cipher = createProjectAccountRowCipherV1({ mode: 'plain', material: null,
            randomBytes: () => { throw new Error('Plain rows must remain keyless'); } });
        const rows = new Map<string, ProjectAccountRowV1>([[physicalKey, { key, revision: 0, content: cipher.seal({ key,
            value: { id: 'ref', serverId: 'home', machineId: 'machine', rootPath: '/repo', createdAtMs: 1, projectKey: 'anchor', label: 'Before' } }) }]]);
        const changes: ApiChangeEntry[] = [];
        let offline = false;
        let listReads = 0;
        // This boundary models the server's canonical row responses and content-free publication;
        // both UI clients run the real cipher, row sync owner, store, planner, and applier.
        const transport: ProjectAccountRowsTransport = {
            list: async () => {
                listReads++;
                if (offline) throw new Error('offline');
                return { status: 'listed', coverage: 'complete', rows: [...rows.values()] };
            },
            mutate: async (request) => {
                const updated: ProjectAccountRowV1[] = [];
                for (const mutation of request.mutations) {
                    const id = buildProjectAccountRowPhysicalKeyV1(mutation.key);
                    const prior = rows.get(id);
                    if ((prior?.revision ?? 'absent') !== mutation.expectedRevision) return { status: 'conflict', key: mutation.key, revision: prior?.revision ?? -1 };
                    const row = { key: mutation.key, revision: (prior?.revision ?? -1) + 1, content: mutation.content };
                    rows.set(id, row); updated.push(row);
                    changes.push(hintChange(ProjectAccountRowChangeHintV1Schema.parse({ projectAccountRow: true, key: row.key, revision: row.revision }), id));
                }
                return { status: 'updated', rows: updated, cursor: 7 };
            },
        };
        function client() {
            const store = createStore<ProjectAccountRowsDomain>()((set, get) => createProjectAccountRowsDomain({ set, get }));
            store.getState().activateProjectAccountRowsScope(scope);
            const owner = createProjectAccountRowsSync({ scope, transport, cipher, isCurrent: () => true,
                apply: (...args) => store.getState().applyProjectAccountRowsForScope(scope, ...args),
                onRefreshFailure: () => store.getState().setProjectAccountRowsStatusForScope(scope, 'error') });
            return { store, owner };
        }
        const first = client();
        const second = client();
        second.owner.refreshRecency(() => 41);
        expect(second.store.getState().projectAccountRows).toMatchObject({ status: 'idle', coverage: 'unknown', workspaceRefs: [] });
        expect(second.store.getState().projectAccountRows?.lastReadyAtMs).toBeUndefined();
        await second.owner.refresh();
        const ready = second.store.getState().projectAccountRows!;
        expect(second.store.getState().projectAccountRows?.workspaceRefs[0]?.label).toBe('Before');
        expect(ready).toMatchObject({ status: 'ready', coverage: 'complete', lastReadyAtMs: 1_000 });
        clock.mockReturnValue(2_000);
        expect(await first.owner.mutateRef({ kind: 'set_label', serverId: 'home', workspaceRefId: 'ref', label: 'After' })).toEqual({ ok: true });
        const planned = planSyncActionsFromChanges(changes);
        expect(planned.projectAccountRowKeys).toEqual([physicalKey]);
        expect(planned.invalidate.settings).toBe(false);
        expect(planned.invalidate.profile).toBe(false);
        const refreshed: string[] = [];
        const base = applyBase(planned, refreshed);
        offline = true;
        expect(await applyPlannedChangeActions({ ...base, materializeProjectAccountRow: async () => { await second.owner.refresh(); } }))
            .toMatchObject({ status: 'partial', safeAdvanceCursor: null, blockedCursor: '7', blockedReason: 'partial-materialization' });
        expect(second.store.getState().projectAccountRows?.workspaceRefs[0]?.label).toBe('Before');
        expect(second.store.getState().projectAccountRows).toMatchObject({ status: 'error', coverage: 'complete', lastReadyAtMs: 1_000 });
        expect(second.store.getState().projectAccountRows?.workspaceRefs).toBe(ready.workspaceRefs);
        clock.mockReturnValue(3_000);
        const readsBeforeRecency = listReads;
        second.owner.refreshRecency(() => 42);
        expect(listReads).toBe(readsBeforeRecency);
        expect(second.store.getState().projectAccountRows).toMatchObject({ status: 'error', coverage: 'complete', lastReadyAtMs: 1_000,
            workspaceRefs: [{ id: 'ref', label: 'Before', lastOpenedAtMs: 42 }] });
        const stale = second.store.getState();
        second.owner.refreshRecency();
        expect(second.store.getState()).toBe(stale);
        clock.mockReturnValue(4_000);
        offline = false;
        expect(await applyPlannedChangeActions({ ...base, materializeProjectAccountRow: async () => { await second.owner.refresh(); } }))
            .toMatchObject({ status: 'complete', safeAdvanceCursor: '7' });
        expect(second.store.getState().projectAccountRows?.workspaceRefs[0]?.label).toBe('After');
        expect(second.store.getState().projectAccountRows).toMatchObject({ status: 'ready', coverage: 'complete', lastReadyAtMs: 4_000,
            workspaceRefs: [{ id: 'ref', label: 'After', lastOpenedAtMs: 42 }] });
        clock.mockReturnValue(5_000);
        second.owner.refreshRecency(() => 43);
        expect(second.store.getState().projectAccountRows).toMatchObject({ status: 'ready', coverage: 'complete', lastReadyAtMs: 4_000,
            workspaceRefs: [{ id: 'ref', label: 'After', lastOpenedAtMs: 43 }] });
        expect(refreshed).toEqual([]);
        expect(changes).toEqual([hintChange()]);
    });

    it('holds the durable cursor when the row materialization owner is unavailable', async () => {
        const planned = planSyncActionsFromChanges([hintChange()]);
        const refreshed: string[] = [];
        expect(await applyPlannedChangeActions(applyBase(planned, refreshed)))
            .toMatchObject({ status: 'partial', safeAdvanceCursor: null, blockedCursor: '7', blockedReason: 'partial-materialization' });
        expect(refreshed).toEqual([]);
    });

    it.each([
        hintChange({ projectAccountRow: true, key: { ...key, id: 'other' }, revision: 1 }),
        hintChange({ projectAccountRow: true, key, revision: 1, settingsVersion: 9 }),
        hintChange({ projectAccountRow: false, key, revision: 1 }),
        hintChange(undefined, 'self'),
        hintChange(null),
    ])('refuses malformed or unbound row hints before any Account privilege', async change => {
        const planned = planSyncActionsFromChanges([change]);
        expect(planned.projectAccountRowKeys).toEqual([]);
        expect(planned.invalidate.settings).toBe(false);
        expect(planned.invalidate.profile).toBe(false);
        const refreshed: string[] = [];
        expect(await applyPlannedChangeActions({ ...applyBase(planned, refreshed),
            materializeProjectAccountRow: async () => { refreshed.push('row'); } }))
            .toMatchObject({ status: 'partial', safeAdvanceCursor: null, blockedCursor: '7', blockedReason: 'unsupported-hint' });
        expect(refreshed).toEqual([]);
    });
});
