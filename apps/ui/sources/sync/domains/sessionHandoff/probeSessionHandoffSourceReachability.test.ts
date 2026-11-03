import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createMachineFixture, createPlainMachineRowFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createHomeGovernanceHarness, installHomeGovernanceBoundaries } from '@/dev/testkit/harness/homeGovernanceHarness';
import { installSessionActionRpcBoundary } from '@/dev/testkit/harness/sessionActionRpcBoundary';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';

type DaemonRequest = Readonly<{ homeOrigin: string | null; machineId: string; method: string; payload: unknown; signal: AbortSignal }>;

// Home HTTP and the Socket.IO RPC reply are the boundary; the scoped Machine RPC owner stays real.
const home = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(home);
const daemon = {
    requests: [] as DaemonRequest[],
    reply: (_request: DaemonRequest): unknown => ({}),
};
installSessionActionRpcBoundary((request, context) => {
    const separator = request.method.indexOf(':');
    const call = { homeOrigin: context.serverUrl ? new URL(context.serverUrl).origin : null,
        machineId: request.method.slice(0, separator), method: request.method.slice(separator + 1),
        payload: request.params, signal: context.signal };
    daemon.requests.push(call);
    return daemon.reply(call);
});
await loadSyncSingletonForTests();
const { storage } = await import('@/sync/domains/state/storage');
const { serverScopedRpcSocketPool } = await import('@/sync/runtime/orchestration/serverScopedRpc/serverScopedRpcSocketPool');
const { probeSessionHandoffSourceReachability } = await import('./probeSessionHandoffSourceReachability');

const accountId = 'handoff-account';
let sourceHomeId = '';

async function addHome(name: string, serverUrl: string): Promise<string> {
    const serverId = await home.addHome({ name, serverUrl, accountId, currentAccount: true });
    for (const id of ['machine-a', 'machine-b']) {
        home.answer(serverId, `/v1/machines/${id}`, { body: { machine: createPlainMachineRowFixture({ id, accountId }) } });
    }
    storage.getState().applyMachines(['machine-a', 'machine-b'].map(id => createMachineFixture({ id, activeAt: Date.now() })),
        true, { sourceServerId: serverId, sourceAccountId: accountId });
    storage.getState().markMachineListSettled(serverId);
    return serverId;
}

describe('probeSessionHandoffSourceReachability', () => {
    beforeEach(async () => {
        await home.reset();
        daemon.requests.length = 0;
        daemon.reply = () => ({});
        // The probed Session lives on a Home that is not the focused one.
        const focusedHomeId = await addHome('Focused Home', 'https://focused-home.test');
        sourceHomeId = await addHome('Source Home', 'https://source-home.test');
        storage.getState().activateProfileScope({ serverId: focusedHomeId, accountId });
        storage.setState({ settingsScope: { serverId: focusedHomeId, accountId } });
    });
    afterEach(async () => {
        await serverScopedRpcSocketPool.stopAll();
        await home.reset();
    });

    it('asks the source daemon for its capabilities on the Session Home and reports it reachable', async () => {
        await expect(probeSessionHandoffSourceReachability({ serverId: sourceHomeId, sourceMachineId: 'machine-a' }))
            .resolves.toBe('reachable');
        expect(daemon.requests.map(({ homeOrigin, machineId, method, payload }) => ({ homeOrigin, machineId, method, payload })))
            .toEqual([{ homeOrigin: 'https://source-home.test', machineId: 'machine-a', method: RPC_METHODS.CAPABILITIES_DESCRIBE, payload: {} }]);
    });

    it('reports unavailable when the source daemon probe fails', async () => {
        daemon.reply = () => { throw new Error('daemon unavailable'); };
        await expect(probeSessionHandoffSourceReachability({ serverId: sourceHomeId, sourceMachineId: 'machine-a' }))
            .resolves.toBe('unavailable');
        expect(daemon.requests).toHaveLength(1);
    });

    it('shares one in-flight probe per Home and Machine and asks nothing without a Machine', async () => {
        const replies: Array<() => void> = [];
        daemon.reply = () => new Promise<object>(resolve => { replies.push(() => resolve({})); });
        await expect(probeSessionHandoffSourceReachability({ serverId: sourceHomeId, sourceMachineId: '  ' })).resolves.toBe('unavailable');
        const first = probeSessionHandoffSourceReachability({ serverId: sourceHomeId, sourceMachineId: 'machine-a' });
        const joined = probeSessionHandoffSourceReachability({ serverId: ` ${sourceHomeId} `, sourceMachineId: 'machine-a' });
        const otherMachine = probeSessionHandoffSourceReachability({ serverId: sourceHomeId, sourceMachineId: 'machine-b' });
        await expect.poll(() => daemon.requests.length).toBe(2);
        expect(daemon.requests.map(request => request.machineId).sort()).toEqual(['machine-a', 'machine-b']);
        for (const reply of replies) reply();
        await expect(Promise.all([first, joined, otherMachine])).resolves.toEqual(['reachable', 'reachable', 'reachable']);
        // Sharing ends with the probe: the next check asks the daemon again.
        daemon.reply = () => ({});
        await expect(probeSessionHandoffSourceReachability({ serverId: sourceHomeId, sourceMachineId: 'machine-a' })).resolves.toBe('reachable');
        expect(daemon.requests).toHaveLength(3);
    });

    it('bounds a silent daemon by the clamped probe deadline', async () => {
        daemon.reply = request => new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
        const startedAt = Date.now();
        // A 1 ms request is raised to the 250 ms floor rather than failing before the daemon can answer.
        await expect(probeSessionHandoffSourceReachability({ serverId: sourceHomeId, sourceMachineId: 'machine-a', timeoutMs: 1 }))
            .resolves.toBe('unavailable');
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(245);
    });
});
