import { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { MachineVitalsSampleV1 } from '@happier-dev/protocol/machines/vitals/machineVitalsSampleV1';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createHomeGovernanceHarness, installHomeGovernanceBoundaries } from '@/dev/testkit/harness/homeGovernanceHarness';
import { installDisconnectedServerSocketBoundary } from '@/dev/testkit/harness/serverAccountConnectionHarness';
import { publishMachineInventoryForTest } from '@/dev/testkit/harness/machinePresence';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createDeferred } from '@/dev/testkit';
import { createProcessesAnswer } from '@/components/machines/processes/testkit/processesAnswerFixture';
import type { MachineProcessesWatchInputV1, MachineProcessesWatchResultV1, ProcessSampleV1 } from '@happier-dev/protocol/machines/processes/machineProcessesV1';

installDisconnectedServerSocketBoundary();
const network = vi.hoisted(() => ({ rpc: vi.fn() }));
// Only the machine network is replaced: credentials, Actions, hooks, schemas and stores remain real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: network.rpc }));
const home = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(home);
const { machineProcessesStore } = await import('../processes/machineProcessesStore');
const { machineStorageStore } = await import('../storage/machineStorageStore');
const { useMachineVitalsAttribution } = await import('./useMachineVitalsAttribution');
const { useMachineProcesses } = await import('../processes/useMachineProcesses');
const { storage } = await import('@/sync/domains/state/storageStore');
const beforeState = storage.getState();
beforeEach(async () => { await home.reset(); machineProcessesStore.reset(); machineStorageStore.reset(); network.rpc.mockReset(); });
afterEach(async () => { standardCleanup(); machineProcessesStore.reset(); machineStorageStore.reset(); storage.setState(beforeState); await home.reset(); });

it('receives zero Processes history bytes on Overview, then a tree baseline and only new samples when Processes opens', async () => {
    const serverId = await home.addHome({ name: 'History demand', serverUrl: 'https://history-demand.test', accountId: 'owner', currentAccount: true });
    await publishMachineInventoryForTest({ serverId, accountId: 'owner' }, [createMachineFixture({ id: 'machine', active: true, activeAt: Date.now() })]);
    const answer = createProcessesAnswer();
    const baseline: ProcessSampleV1[] = Array.from({ length: 1801 }, (_, index) => ({ capturedAtMs: 1000 + index * 2000, memoryBytes: 60, cpuPercent: 25 }));
    const watches: Array<{ payload: MachineProcessesWatchInputV1; signal?: AbortSignal;
        response: ReturnType<typeof createDeferred<MachineProcessesWatchResultV1>> }> = [];
    const received: Array<{ samples: number; historyBytes: number }> = [];
    // Network fixtures follow the daemon's two existing projections. The real hook, Action,
    // transport decoder and shared store decide which projection is requested and retain deltas.
    network.rpc.mockImplementation(async ({ method, payload, signal }: { method: string; payload: MachineProcessesWatchInputV1; signal?: AbortSignal }) => {
        if (method === RPC_METHODS.DAEMON_PROCESSES_WATCH) {
            const response = createDeferred<MachineProcessesWatchResultV1>();
            watches.push({ payload, signal, response });
            signal?.addEventListener('abort', () => response.resolve({ changed: false }), { once: true });
            return response.promise;
        }
        if (method === RPC_METHODS.MACHINES_PROCESSES_LIST) return { ...answer,
            owners: answer.owners.map(owner => payload.view === 'owners' ? { ...owner, members: [] } : owner) };
        if (method === RPC_METHODS.DAEMON_STORAGE_WATCH) return new Promise(resolve =>
            signal?.addEventListener('abort', () => resolve({ changed: false }), { once: true }));
        return { revision: 1, sizedAt: 1000, volumes: [], categories: [], suggestionsTop: [],
            pile: { count: 0, freesBytes: 0, droppedSinceLastView: [] }, trash: { count: 0, allocatedBytes: 0 }, wholeDisk: { enabled: false, scans: [] } };
    });
    const deliver = async (index: number, samples: ProcessSampleV1[]) => {
        await act(async () => { await vi.waitFor(() => expect(watches).toHaveLength(index + 1)); });
        const watch = watches[index];
        const history = watch.payload.view === 'tree' ? Object.fromEntries(answer.owners.map(owner => [owner.rowId, samples])) : undefined;
        received.push({ samples: Object.values(history ?? {}).reduce((count, points) => count + points.length, 0),
            historyBytes: history ? new TextEncoder().encode(JSON.stringify(history)).byteLength : 0 });
        await act(async () => {
            watch.response.resolve({ changed: true, answer: { ...answer, capturedAtMs: samples.at(-1)!.capturedAtMs,
                owners: answer.owners.map(owner => watch.payload.view === 'owners' ? { ...owner, members: [] } : owner),
                ...(history ? { history } : {}) } });
            await vi.waitFor(() => expect(watches).toHaveLength(index + 2));
        });
    };
    const overview = await renderHook(({ enabled }: { enabled: boolean }) => useMachineVitalsAttribution({
        serverId, machineId: 'machine', online: true, enabled, sample: null,
    }), { initialProps: { enabled: true } });
    await deliver(0, baseline);
    expect(received).toEqual([{ samples: 0, historyBytes: 0 }]);
    expect(overview.getCurrent().processes.answer?.history).toBeUndefined();
    expect(overview.getCurrent().processes.answer?.owners.every(owner => owner.members.length === 0)).toBe(true);
    expect(overview.getCurrent().happier?.memoryBytes).toBe(answer.totals.happier.memoryBytes);
    await overview.rerender({ enabled: false });
    expect(watches[1].signal?.aborted).toBe(true);

    const processes = await renderHook(() => useMachineProcesses({ serverId, machineId: 'machine', online: true, scope: 'happier', view: 'tree' }));
    await deliver(2, baseline);
    expect(watches[2].payload.historySince).toBeUndefined();
    expect(received[1].samples).toBe(answer.owners.length * baseline.length);
    let newest = baseline.at(-1)!.capturedAtMs;
    for (let index = 3; index < 5; index++) {
        expect(watches[index].payload.historySince).toBe(newest);
        newest += 2000;
        await deliver(index, [{ capturedAtMs: newest, memoryBytes: 70, cpuPercent: 30 }]);
        const last = received.at(-1)!;
        expect(last.samples).toBe(answer.owners.length);
        expect(last.historyBytes).toBeLessThan(received[1].historyBytes / baseline.length * 2);
        expect(processes.getCurrent().answer?.history?.[answer.owners[0].rowId].at(-1)?.capturedAtMs).toBe(newest);
    }
    expect(processes.getCurrent().answer?.owners[0].members.length).toBeGreaterThan(0);
    expect(overview.getCurrent().processes.answer?.history).toBeUndefined();
    console.info('FX-J8I Processes history cost / Overview, baseline, two deltas', received);
    await processes.unmount();
    await overview.unmount();
});

it.each(['transport', 'native'] as const)('recovers compact Overview after a %s failure and a visit to the separate Processes tree', async failure => {
    const serverId = await home.addHome({ name: 'Shared census', serverUrl: 'https://shared-census.test', serverIdentityId: 'srv_shared_census', accountId: 'owner', currentAccount: true });
    await publishMachineInventoryForTest({ serverId, accountId: 'owner' }, [createMachineFixture({ id: 'machine', active: true, activeAt: Date.now() })]);
    const answer = { v: 1, machineId: 'machine', capturedAtMs: 1000, state: 'live', platform: 'linux', evidenceModel: 'fenced', owners: [], leftBehind: [],
        totals: { happier: { processCount: 2, memoryBytes: 60, cpuPercent: 25 }, leftBehind: { processCount: 0, memoryBytes: 0 } } };
    let failed = false;
    network.rpc.mockImplementation(async ({ method, signal }: { method: string; signal?: AbortSignal }) => {
        if (method === RPC_METHODS.DAEMON_PROCESSES_WATCH || method === RPC_METHODS.DAEMON_STORAGE_WATCH) {
            return new Promise(resolve => signal?.addEventListener('abort', () => resolve({ changed: false }), { once: true }));
        }
        if (method === RPC_METHODS.MACHINES_PROCESSES_LIST) {
            if (!failed) {
                failed = true;
                if (failure === 'transport') throw new Error('Machine transport disconnected');
                return { ...answer, state: 'unavailable', reason: 'read_failed' };
            }
            return answer;
        }
        return { revision: 1, sizedAt: 1000, volumes: [], categories: [], suggestionsTop: [],
            pile: { count: 0, freesBytes: 0, droppedSinceLastView: [] }, trash: { count: 0, allocatedBytes: 0 },
            wholeDisk: { enabled: false, scans: [] } };
    });
    const attribution = await renderHook(({ enabled }: { enabled: boolean }) => useMachineVitalsAttribution({
        serverId, machineId: 'machine', online: true, enabled, sample: null,
    }), { initialProps: { enabled: true } });
    await act(async () => { await vi.waitFor(() => expect(attribution.getCurrent().processes.status)
        .toBe(failure === 'transport' ? 'error' : 'unavailable')); });
    // Tab navigation releases sampling. The tree has its own projection and cannot
    // replace Overview's compact snapshot with members or chart history.
    await attribution.rerender({ enabled: false });
    const processes = await renderHook(() => useMachineProcesses({ serverId, machineId: 'machine', online: true, scope: 'happier', view: 'tree' }));
    await act(async () => { await vi.waitFor(() => expect(processes.getCurrent().status).toBe('ready')); });
    expect(attribution.getCurrent().processes.status).toBe(failure === 'transport' ? 'error' : 'unavailable');
    await processes.unmount();
    await attribution.rerender({ enabled: true });
    await act(async () => { await vi.waitFor(() => expect(attribution.getCurrent().processes.status).toBe('ready')); });
    expect(attribution.getCurrent().happier).toMatchObject({ memoryBytes: 60, cpuPercent: 25 });
    expect(attribution.getCurrent().processes.answer?.history).toBeUndefined();
    expect(network.rpc.mock.calls.filter(([input]) => input.method === RPC_METHODS.MACHINES_PROCESSES_LIST)
        .map(([input]) => input.payload.view)).toEqual(['owners', 'tree', 'owners']);
    await attribution.unmount();
});

it('combines canonical totals without dividing whole-machine CPU again, leaves left-behind out of everything else and clamps to zero', async () => {
    const serverId = await home.addHome({ name: 'Attribution', serverUrl: 'https://attribution.test', serverIdentityId: 'srv_attribution', accountId: 'owner', currentAccount: true });
    await publishMachineInventoryForTest({ serverId, accountId: 'owner' }, [createMachineFixture({ id: 'machine', active: true, activeAt: Date.now() })]);
    home.answer(serverId, '/v2/account/settings', { body: { content: { t: 'plain', v: {} }, version: 1 } });
    network.rpc.mockImplementation(async ({ method, signal }: { method: string; signal?: AbortSignal }) => {
        if (method === RPC_METHODS.DAEMON_PROCESSES_WATCH || method === RPC_METHODS.DAEMON_STORAGE_WATCH) {
            return new Promise(resolve => signal?.addEventListener('abort', () => resolve({ changed: false }), { once: true }));
        }
        if (method === RPC_METHODS.MACHINES_PROCESSES_LIST) return { v: 1, machineId: 'machine', capturedAtMs: 1000, state: 'live', platform: 'linux', evidenceModel: 'fenced', owners: [], leftBehind: [],
            totals: { happier: { processCount: 2, memoryBytes: 60, cpuPercent: 25 }, leftBehind: { processCount: 1, memoryBytes: 4, cpuPercent: 5 } } };
        return { revision: 1, sizedAt: 1000, volumes: [{ volume: { volumeId: 'disk', mountPath: '/', label: 'Disk' }, totalBytes: 100, freeBytes: 20, happierBytes: 30, pileBytes: 0, trashBytes: 0 }],
            categories: [], suggestionsTop: [], pile: { count: 0, freesBytes: 0, droppedSinceLastView: [] }, trash: { count: 0, allocatedBytes: 0 }, wholeDisk: { enabled: false, scans: [] } };
    });
    const sample: MachineVitalsSampleV1 = { v: 1, sampledAt: 1000, intervalMs: 2000,
        cpu: { reported: true, busyPct: 80 }, memory: { reported: true, totalBytes: 100, availableBytes: 50, usedBytes: 50, pressure: { level: 'calm', source: 'psi' } },
        disk: { reported: true, volumes: [] }, network: { reported: false, reason: 'unavailable' } };
    const hook = await renderHook(() => useMachineVitalsAttribution({ serverId, machineId: 'machine', sample, online: true }));
    await act(async () => { await vi.waitFor(() => expect(hook.getCurrent().processes.status).toBe('ready')); });
    await act(async () => { await vi.waitFor(() => expect(hook.getCurrent().storage.status,
        JSON.stringify({ paths: home.requests.map(request => request.path), methods: network.rpc.mock.calls.map(([input]) => input.method) })).toBe('ready')); });
    expect(hook.getCurrent()).toMatchObject({ happier: { memoryBytes: 60, cpuPercent: 25 }, everythingElse: { memoryBytes: 0, cpuPercent: 50 }, storage: { summary: { volumes: [{ happierBytes: 30 }] } } });
    await hook.unmount();
});
