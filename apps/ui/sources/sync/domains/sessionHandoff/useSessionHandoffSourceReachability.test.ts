import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createWorkspaceSyncHarness } from '@/dev/testkit/harness/workspaceSyncHarness';

// The daemon's Socket.IO reply is the boundary; the probe and scoped Machine RPC stay real.
const daemon = {
    probes: [] as string[],
    reply: (): unknown => new Promise<never>(() => undefined),
};
const home = createWorkspaceSyncHarness(input => {
    if (input.method !== RPC_METHODS.CAPABILITIES_DESCRIBE) throw new Error(`Unexpected RPC: ${input.method}`);
    daemon.probes.push(input.machineId);
    return daemon.reply();
});
await home.ready;
const {
    invalidateCachedTransferRoutesForServer,
    recordCachedMachineRpcDirectRouteUnavailable,
    recordCachedMachineRpcDirectRouteViable,
} = await import('@/sync/domains/transfers/runtime/transferRouteCache');
const { useSessionHandoffSourceReachability } = await import('./useSessionHandoffSourceReachability');

const failProbe = () => { throw new Error('source daemon unavailable'); };

describe('useSessionHandoffSourceReachability', () => {
    beforeEach(async () => {
        await home.reset();
        daemon.probes.length = 0;
        daemon.reply = () => new Promise<never>(() => undefined);
        invalidateCachedTransferRoutesForServer({ serverId: home.serverId });
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        standardCleanup();
        invalidateCachedTransferRoutesForServer({ serverId: home.serverId });
        await home.dispose();
    });

    it('downgrades from reachable to unknown when the server-scoped cache is invalidated', async () => {
        recordCachedMachineRpcDirectRouteViable({ serverId: home.serverId, remoteMachineId: 'machine-a' });

        const hook = await renderHook(() => useSessionHandoffSourceReachability({
            serverId: home.serverId,
            sourceMachineId: 'machine-a',
        }));

        expect(hook.getCurrent()).toBe('reachable');

        await act(async () => {
            invalidateCachedTransferRoutesForServer({ serverId: home.serverId });
        });

        expect(hook.getCurrent()).toBe('unknown');

        await hook.unmount();
    });

    it('returns unavailable immediately when the server-scoped cache already proves the route is unavailable', async () => {
        recordCachedMachineRpcDirectRouteUnavailable({ serverId: home.serverId, remoteMachineId: 'machine-b' },
            'machine_rpc_direct_unavailable');

        const hook = await renderHook(() => useSessionHandoffSourceReachability({
            serverId: home.serverId,
            sourceMachineId: 'machine-b',
        }));
        await act(async () => { await Promise.resolve(); });

        expect(hook.getCurrent()).toBe('unavailable');
        expect(daemon.probes).toEqual([]);

        await hook.unmount();
    });

    it('keeps retrying after repeated transient unavailable probes and promotes to reachable when a later probe succeeds within the retry window', async () => {
        const replies = [failProbe, failProbe, () => ({})];
        daemon.reply = () => (replies.shift() ?? failProbe)();
        vi.useFakeTimers();

        const hook = await renderHook(() => useSessionHandoffSourceReachability({
            serverId: home.serverId,
            sourceMachineId: 'machine-c',
        }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(daemon.probes).toHaveLength(1);
        expect(hook.getCurrent()).toBe('unavailable');

        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

        expect(daemon.probes).toHaveLength(2);
        expect(hook.getCurrent()).toBe('unavailable');

        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

        expect(daemon.probes).toHaveLength(3);
        expect(hook.getCurrent()).toBe('reachable');

        // A reachable source ends probing.
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(daemon.probes).toHaveLength(3);

        await hook.unmount();
    });

    it('stops probing an unavailable source once its retry window is spent', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_SESSION_HANDOFF_SOURCE_REACHABILITY_RETRY_WINDOW_MS', '3000');
        daemon.reply = failProbe;
        vi.useFakeTimers();

        const hook = await renderHook(() => useSessionHandoffSourceReachability({
            serverId: home.serverId,
            sourceMachineId: 'machine-z',
        }));
        // One act per retry delay lets each failed probe schedule the next.
        const advanceOneRetry = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1_000); }); };
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        for (let second = 0; second < 3; second += 1) await advanceOneRetry();
        // Probes at 0, 1 s, 2 s and 3 s; the 3 s window closes before a fifth.
        expect(daemon.probes).toHaveLength(4);
        for (let second = 0; second < 60; second += 1) await advanceOneRetry();

        expect(daemon.probes).toHaveLength(4);
        expect(hook.getCurrent()).toBe('unavailable');

        await hook.unmount();
    });
});
