import {
    createManagedConnectionSupervisor,
    DEFAULT_MANAGED_CONNECTION_POLICY,
    type ManagedConnectionSupervisor,
    type ManagedConnectionSupervisorConfig,
} from '@happier-dev/connection-supervisor';

/** Persistent socket demand follows HTTP readiness, without writing HTTP verdicts. */
export function createSocketConnectionSupervisor(
    config: Pick<ManagedConnectionSupervisorConfig, 'createTransport' | 'onConnected' | 'onStateChange'>
        & Partial<Pick<ManagedConnectionSupervisorConfig, 'probeReadiness' | 'classifyTransportErrorToProbeResult' | 'onAuthFailed'>>,
): ManagedConnectionSupervisor {
    const supervisor = createManagedConnectionSupervisor({
        ...DEFAULT_MANAGED_CONNECTION_POLICY,
        probeReadiness: async () => ({ status: 'ready' }),
        ...config,
        onConnected: context => {
            supervisor.resetRetryBackoff?.();
            return config.onConnected?.(context);
        },
    });
    return supervisor;
}
