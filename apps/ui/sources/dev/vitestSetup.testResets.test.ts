import { describe, expect, it } from 'vitest';

import {
    readMachineRequestReachabilityObservation,
    recordMachineRequestFailed,
} from '@/sync/domains/machines/reachability/machineReachability';

const scope = { serverId: 'server-test-resets', accountId: 'account-test-resets' };

// The two cases run in order: the second proves the global setup reset what the first recorded.
describe('vitest setup per-test resets', () => {
    it('lets a test record Machine request reachability', () => {
        recordMachineRequestFailed({ ...scope, machineId: 'machine-a', observedAtMs: 1 });
        expect(readMachineRequestReachabilityObservation(scope, 'machine-a')).toEqual({ outcome: 'failed', observedAtMs: 1 });
    });

    it('starts the next test without the previous test observation', () => {
        expect(readMachineRequestReachabilityObservation(scope, 'machine-a')).toBeNull();
    });
});
