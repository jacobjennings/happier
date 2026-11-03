import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
    OS: 'ios' as string,
    constants: undefined as { isMacCatalyst?: boolean } | undefined,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() { return platform.OS; },
            get constants() { return platform.constants; },
        },
    });
});
// Import-graph guard: the subject must never load react-native-device-info (it is
// unavailable on web builds). Loading it fails this whole file at import time.
vi.mock('react-native-device-info', () => {
    throw new Error('react-native-device-info should not be imported');
});

import { isRunningOnMac } from './platform';

describe('isRunningOnMac', () => {
    beforeEach(() => {
        platform.OS = 'ios';
        platform.constants = undefined;
    });

    it('returns false for web builds without importing react-native-device-info', () => {
        platform.OS = 'web';
        expect(isRunningOnMac()).toBe(false);
    });

    it('returns false on non-iOS platforms', () => {
        platform.OS = 'android';
        platform.constants = { isMacCatalyst: true };
        expect(isRunningOnMac()).toBe(false);
    });

    it('returns true when Platform.constants.isMacCatalyst is true', () => {
        platform.constants = { isMacCatalyst: true };
        expect(isRunningOnMac()).toBe(true);
    });

    it('returns false when constants or the Catalyst flag are unavailable', () => {
        expect(isRunningOnMac()).toBe(false);
        platform.constants = {};
        expect(isRunningOnMac()).toBe(false);
    });

    it('returns false when isMacCatalyst is explicitly false', () => {
        platform.constants = { isMacCatalyst: false };
        expect(isRunningOnMac()).toBe(false);
    });
});
