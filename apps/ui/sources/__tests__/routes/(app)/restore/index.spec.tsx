import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installRestoreRouteCommonModuleMocks, resetRestoreRouteTestState } from './restoreRouteTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

installRestoreRouteCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Text: 'Text',
            ScrollView: 'ScrollView',
            ActivityIndicator: 'ActivityIndicator',
            Dimensions: {
                get: () => ({ width: 1600, height: 900, scale: 2, fontScale: 1 }),
            },
            useWindowDimensions: () => ({ width: 1600, height: 900, scale: 2, fontScale: 1 }),
            Platform: {
                OS: 'web',
                select: (options: any) => options?.web ?? options?.default ?? options?.ios ?? options?.android,
            },
            AppState: {
                addEventListener: () => ({ remove: () => {} }),
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
            params: {
                provider: 'github',
                reason: 'provider_already_linked',
            },
        });
        return routerMock.module;
    },
});

// Camera permission and the server capability fetch are native/network boundaries.
vi.mock('expo-camera', () => ({
    useCameraPermissions: () => [{ granted: true }, vi.fn(async () => ({ granted: true }))],
    CameraView: {
        isModernBarcodeScannerAvailable: false,
        launchScanner: vi.fn(),
        dismissScanner: vi.fn(async () => {}),
        onModernBarcodeScanned: vi.fn(() => ({ remove: () => {} })),
    },
}));

vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: vi.fn(async () => null),
}));

afterEach(async () => {
    await standardCleanup();
    vi.restoreAllMocks();
    resetRestoreRouteTestState();
});

const { InjectedAuthProvider } = await import('@/auth/context/AuthContext');
const { githubAuthProvider } = await import('@/auth/providers/github');
const { default: Screen } = await import('@/app/(app)/restore/index');

describe('/restore', () => {
    it('shows the real provider restore notice when redirected after external auth', async () => {
        const screen = await renderScreen(<InjectedAuthProvider credentials={null}><Screen /></InjectedAuthProvider>);

        expect(screen.findByTestId('restore-wizard')).toBeTruthy();

        const notice = githubAuthProvider.getRestoreRedirectNotice?.({ reason: 'provider_already_linked' });
        if (!notice) throw new Error('Expected the github provider restore notice');
        const joined = screen.getTextContent();
        expect(joined).toContain(notice.title);
        expect(joined).toContain(notice.body);
    });
});
