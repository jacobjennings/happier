import type { ManagedMachineV1 } from '@happier-dev/protocol/machines/managed/managedMachineV1';

/** Provider/allocation evidence of removal, independent of enrollment history or list membership. */
export function isManagedMachineResourceAbsent(machine: Pick<ManagedMachineV1, 'allocation' | 'observation'>): boolean {
    return machine.allocation === 'confirmed-absent' || machine.observation?.availability === 'absent';
}
