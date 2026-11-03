import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createMachineFixture, createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { EMPTY_SCM_CAPABILITIES } from '@/scm/core/snapshotMappers';
import { scmStatusSync } from '@/scm/scmStatusSync';
import { storage } from '@/sync/domains/state/storage';

const appStateEmitter = vi.hoisted(async () => {
    const { createReactNativeAppStateEmitter } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeAppStateEmitter('active');
});
const machineRpc = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: { get OS() { return 'web'; } },
        AppState: (await appStateEmitter).appState,
    });
});

vi.mock('@/utils/platform/desktopHost', () => ({
    isDesktopHost: () => false,
}));

// The Machine RPC transport is external; the status sync owner, repository service and store stay real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async () => {
    const { createServerScopedMachineRpcBoundaryMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return createServerScopedMachineRpcBoundaryMock(machineRpc);
});

const snapshotRequests = () => machineRpc.mock.calls
    .map(([request]) => request)
    .filter((request) => request?.method === RPC_METHODS.SCM_STATUS_SNAPSHOT);

// The status sync is a module singleton, so each scenario refreshes its own Session and repository.
function seedRepository(sessionId: string, serverId?: string) {
    const machine = createMachineFixture({ id: `${sessionId}-machine` });
    const base = createSessionFixture();
    const session = createSessionFixture({ id: sessionId, metadata: { ...base.metadata!, machineId: machine.id, path: `/${sessionId}` } });
    storage.setState({
        machines: { [machine.id]: machine },
        sessions: { [session.id]: session },
        ...(serverId ? {
            machineListByServerId: { [serverId]: [machine] },
            sessionListRowsByServerId: { [serverId]: { [session.id]: session } },
        } : {}),
    });
    machineRpc.mockResolvedValue({
        success: true,
        snapshot: {
            projectKey: `${machine.id}:/${sessionId}`, fetchedAt: 1,
            repo: { isRepo: true, rootPath: `/${sessionId}` },
            branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
            stashCount: 0, hasConflicts: false, entries: [],
            totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
            capabilities: EMPTY_SCM_CAPABILITIES,
        },
    });
}

describe('useScmSessionAutoRefresh', () => {
    const globalWithDocument = globalThis as unknown as {
        document?: { visibilityState?: string };
    };
    const originalDocument = globalWithDocument.document;
    const initialState = storage.getState();
    const mounted: Array<readonly [string, string | undefined]> = [];

    beforeEach(async () => {
        vi.useFakeTimers();
        (await appStateEmitter).emit('active');
        globalWithDocument.document = { visibilityState: 'visible' };
    });

    afterEach(() => {
        standardCleanup();
        for (const [sessionId, serverId] of mounted.splice(0)) scmStatusSync.stop(sessionId, serverId);
        vi.useRealTimers();
        globalWithDocument.document = originalDocument;
        storage.setState(initialState, true);
        machineRpc.mockReset();
    });

    async function mountAutoRefresh(sessionId: string, serverId?: string) {
        seedRepository(sessionId, serverId);
        mounted.push([sessionId, serverId]);
        const { useScmSessionAutoRefresh } = await import('./useScmSessionAutoRefresh');
        await renderHook(() => useScmSessionAutoRefresh({ sessionId, ...(serverId ? { serverId } : {}), intervalMs: 300_000 }));
        await vi.advanceTimersByTimeAsync(0);
    }

    it('refreshes on the configured cadence while the runtime is active', async () => {
        await mountAutoRefresh('cadence-session');
        expect(snapshotRequests()).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(300_000);
        expect(snapshotRequests()).toHaveLength(2);
    });

    it('keeps every refresh qualified to the mounted Home', async () => {
        await mountAutoRefresh('home-session', 'home-b');
        await vi.advanceTimersByTimeAsync(300_000);

        expect(snapshotRequests()).toEqual([
            expect.objectContaining({ machineId: 'home-session-machine', serverId: 'home-b' }),
            expect.objectContaining({ machineId: 'home-session-machine', serverId: 'home-b' }),
        ]);
    });

    it('catches up once when the app returns to the foreground overdue', async () => {
        await mountAutoRefresh('catch-up-session');
        expect(snapshotRequests()).toHaveLength(1);

        (await appStateEmitter).emit('background');
        await vi.advanceTimersByTimeAsync(300_000 * 3);
        expect(snapshotRequests()).toHaveLength(1);

        (await appStateEmitter).emit('active');
        await vi.advanceTimersByTimeAsync(0);
        expect(snapshotRequests()).toHaveLength(2);
    });
});
