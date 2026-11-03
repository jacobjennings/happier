import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveDefaultNativeSshSystemTaskCapability } from './native';

describe('native SSH system-task capability', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('fails closed when remote SSH machine setup is denied by build policy', () => {
        // The build policy owner reads its deny list from this build-time public env var.
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY', 'setup.machine.allowRemoteSshMachineSetup');

        expect(resolveDefaultNativeSshSystemTaskCapability()).toEqual(expect.objectContaining({
            available: false,
            unavailableReason: 'feature-disabled',
        }));
    });
});
