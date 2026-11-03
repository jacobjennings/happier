import { afterEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { ScmDiffCache } from '../diffCache/scmDiffCache';
import { fetchWorkspaceUnifiedDiffForPath } from './fetchWorkspaceUnifiedDiffForPath';

const machineRpc = vi.hoisted(() => vi.fn());
// The authenticated Machine RPC transport is external; the SCM facade, cache keys and diff normalization stay real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async () => {
    const { createServerScopedMachineRpcBoundaryMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return createServerScopedMachineRpcBoundaryMock(machineRpc);
});

const diffRequests = () => machineRpc.mock.calls.filter(([request]) => request?.method === RPC_METHODS.SCM_DIFF_FILE);

describe('fetchWorkspaceUnifiedDiffForPath', () => {
    afterEach(() => {
        machineRpc.mockReset();
    });

    it('shares workspace patches and isolates server, machine, root and refresh', async () => {
        const diffCache = new ScmDiffCache({ maxEntries: 10, maxTotalBytes: 10_000, now: () => 1 });
        let requests = 0;
        machineRpc.mockImplementation(async () => ({ success: true, diff: `@@ -1 +1 @@\n-old\n+patch${++requests}\n` }));
        const request = { scope: { serverId: 'a', machineId: 'm', rootPath: '/repo' }, diffArea: 'pending' as const, path: 'a.ts', file: null, normalizeError: String, fallbackError: 'failed', snapshotSignature: 'fresh1', diffCache };
        const [first, second] = await Promise.all([fetchWorkspaceUnifiedDiffForPath(request), fetchWorkspaceUnifiedDiffForPath(request)]);
        expect(first).toEqual(second);
        expect(await fetchWorkspaceUnifiedDiffForPath(request)).toEqual(first);
        expect(requests).toBe(1);
        for (const scope of [{ ...request.scope, serverId: 'b' }, { ...request.scope, machineId: 'm2' }, { ...request.scope, rootPath: '/other' }]) {
            expect(await fetchWorkspaceUnifiedDiffForPath({ ...request, scope })).not.toEqual(first);
        }
        expect(await fetchWorkspaceUnifiedDiffForPath({ ...request, snapshotSignature: 'fresh2' })).not.toEqual(first);
        expect(requests).toBe(5);
        expect(diffRequests()).toHaveLength(5);
    });

    it('keeps workspace server scope when requesting a machine SCM file diff', async () => {
        machineRpc.mockResolvedValue({
            success: true,
            diff: '',
        });

        const response = await fetchWorkspaceUnifiedDiffForPath({
            scope: {
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: '/repo',
            },
            diffArea: 'pending',
            path: 'src/app.ts',
            file: null,
            normalizeError: (input) => String(input),
            fallbackError: 'Failed to load diff',
        });

        expect(response).toEqual({ success: true, diff: '' });
        expect(diffRequests()).toEqual([[expect.objectContaining({
            machineId: 'machine-a',
            serverId: 'server-a',
            payload: expect.objectContaining({ cwd: '/repo', path: 'src/app.ts', area: 'pending' }),
        })]]);
    });
});
