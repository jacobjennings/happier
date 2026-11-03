import { createMachineFixture } from './machineFixtures';

/** Current controllers publish the protocol required by every provisioner Action. */
export function createManagedControllerMachineFixture(overrides: Parameters<typeof createMachineFixture>[0] = {}) {
    return createMachineFixture({ operationProtocolCapabilitiesRevision: 1,
        operationProtocolCapabilities: { externalActionExecutionAuthorization: { protocolVersions: [1] } }, ...overrides });
}
