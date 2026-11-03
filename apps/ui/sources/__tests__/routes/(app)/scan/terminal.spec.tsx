import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installScanRouteCommonModuleMocks,
} from './scanRouteTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerBackSpy = vi.fn();
const routerReplaceSpy = vi.fn();
const promptSpy = vi.fn(async (..._args: unknown[]) => null as string | null);
const alertAsyncSpy = vi.fn(async (..._args: unknown[]) => undefined);
installScanRouteCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Platform: {
                OS: 'ios',
                select: (options: any) => options?.ios ?? options?.default ?? options?.web ?? options?.android,
            },
            AppState: {
                addEventListener: () => ({ remove: () => {} }),
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                back: routerBackSpy,
                replace: routerReplaceSpy,
                canGoBack: () => false,
            },
        }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                prompt: (...args: unknown[]) => promptSpy(...args),
                alertAsync: (...args: unknown[]) => alertAsyncSpy(...args),
            },
        }).module;
    },
});

const processTerminalAuthUrlSpy = vi.fn(async (_url: string) => true);
let lastTerminalConnectOptions: { onSuccess?: () => void | Promise<void> } | undefined;
vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: (options?: { onSuccess?: () => void | Promise<void> }) => {
        lastTerminalConnectOptions = options;
        return { processAuthUrl: processTerminalAuthUrlSpy, isLoading: false };
    },
}));

let lastScannerProps: any = null;
vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => {
        lastScannerProps = props;
        // The real view renders `footer` in the granted, denied and unavailable
        // branches alike; rendering it here keeps the camera-denial paste path
        // reachable from these route tests.
        return React.createElement('QrCodeScannerView', props, props.footer);
    },
}));

// The scanner's connection warning reads the app's auth owner; load it after the module mocks above.
const { InjectedAuthProvider } = await import('@/auth/context/AuthContext');
function renderScanRoute(element: React.ReactElement) {
    return renderScreen(<InjectedAuthProvider credentials={null}>{element}</InjectedAuthProvider>);
}

describe('/scan/terminal', () => {
    beforeEach(() => {
        routerBackSpy.mockClear();
        routerReplaceSpy.mockClear();
        promptSpy.mockClear();
        alertAsyncSpy.mockClear();
        processTerminalAuthUrlSpy.mockClear();
        lastScannerProps = null;
    });

    it('renders the terminal scan wizard shell, whose Back leaves through the safe fallback', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/terminal');

        const screen = await renderScanRoute(<Screen />);

        expect(screen.findByTestId('scan-terminal-wizard')).not.toBeNull();
        expect(lastScannerProps?.embedded).toBe(true);
        expect(lastScannerProps?.permissionRequiredMessage).toBe('modals.cameraPermissionsRequiredToConnectTerminal');

        await screen.pressByTestIdAsync('scan-terminal-wizard-back');

        expect(routerReplaceSpy).toHaveBeenCalledWith('/');
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('processes scanned terminal URLs', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/terminal');

        await renderScanRoute(<Screen />);

        expect(typeof lastScannerProps?.onScan).toBe('function');

        await act(async () => {
            await lastScannerProps.onScan('happier://terminal?key=abc&server=https%3A%2F%2Fapi.happier.dev');
        });

        expect(processTerminalAuthUrlSpy).toHaveBeenCalledTimes(1);
        expect(processTerminalAuthUrlSpy).toHaveBeenCalledWith('happier://terminal?key=abc&server=https%3A%2F%2Fapi.happier.dev');
    });

    it('rejects scanned account URLs from the terminal scanner', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/terminal');

        await renderScanRoute(<Screen />);

        expect(typeof lastScannerProps?.onScan).toBe('function');

        await act(async () => {
            await lastScannerProps.onScan('happier:///account?abc123');
        });

        expect(alertAsyncSpy).toHaveBeenCalledTimes(1);
        expect(alertAsyncSpy).toHaveBeenCalledWith('common.error', 'modals.invalidAuthUrl', [{ text: 'common.ok' }]);
        expect(processTerminalAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('submits a pasted terminal link through the shared scan processor', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/terminal');

        const screen = await renderScanRoute(<Screen />);
        await screen.pressByTestIdAsync('scan-terminal-enter-url');

        await act(async () => {
            screen.changeTextByTestId(
                'restore-pairing-link-input',
                '  happier://terminal?key=manual&server=https%3A%2F%2Fapi.happier.dev  ',
            );
        });
        await act(async () => {
            const submit = screen.findByTestId('restore-pairing-link-submit');
            if (!submit) throw new Error('Expected the terminal link form submit button');
            await submit.props.action();
        });

        expect(promptSpy).not.toHaveBeenCalled();
        expect(processTerminalAuthUrlSpy).toHaveBeenCalledWith('happier://terminal?key=manual&server=https%3A%2F%2Fapi.happier.dev');
    });

    it('uses safe fallback navigation when cancelling without history', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/terminal');

        await renderScanRoute(<Screen />);

        await act(async () => {
            await lastScannerProps.onCancel();
        });

        expect(routerReplaceSpy).toHaveBeenCalledWith('/');
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('uses safe fallback navigation after a successful terminal approval when there is no back stack', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/terminal');

        await renderScanRoute(<Screen />);

        await act(async () => {
            await lastTerminalConnectOptions?.onSuccess?.();
        });

        expect(routerReplaceSpy).toHaveBeenCalledWith('/');
        expect(routerBackSpy).not.toHaveBeenCalled();
    });
});
