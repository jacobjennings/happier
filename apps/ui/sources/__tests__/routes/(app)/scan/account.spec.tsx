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
const routerPushSpy = vi.fn();
const processTerminalAuthUrlSpy = vi.fn(async (_url: string) => true);
const promptSpy = vi.fn(async (..._args: unknown[]) => null as string | null);
const alertAsyncSpy = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: () => {
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

installScanRouteCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                back: routerBackSpy,
                replace: routerReplaceSpy,
                push: routerPushSpy,
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

// The scanner's connection warning reads the app's auth owner; load it after the module mocks above.
const { InjectedAuthProvider } = await import('@/auth/context/AuthContext');
function renderScanRoute(element: React.ReactElement) {
    return renderScreen(<InjectedAuthProvider credentials={null}>{element}</InjectedAuthProvider>);
}

describe('/scan/account', () => {
    beforeEach(() => {
        routerBackSpy.mockClear();
        routerReplaceSpy.mockClear();
        routerPushSpy.mockClear();
        promptSpy.mockClear();
        alertAsyncSpy.mockClear();
        processTerminalAuthUrlSpy.mockClear();
        lastScannerProps = null;
    });

    it('renders the account scan wizard shell, whose Back leaves through the safe fallback', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScanRoute(<Screen />);

        expect(screen.findByTestId('scan-account-wizard')).not.toBeNull();
        expect(lastScannerProps?.embedded).toBe(true);
        expect(lastScannerProps?.permissionRequiredMessage).toBe('modals.cameraPermissionsRequiredToScanQr');

        await screen.pressByTestIdAsync('scan-account-wizard-back');

        expect(routerReplaceSpy).toHaveBeenCalledWith('/');
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('answers a scanned legacy account link with the approval guidance and its show-QR recovery', async () => {
        alertAsyncSpy.mockImplementationOnce(async (...args: unknown[]) => {
            const buttons = args[2] as Array<{ text?: string; onPress?: () => void }>;
            buttons.find((button) => button.text === 'connect.showQrInstead')?.onPress?.();
        });
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScanRoute(<Screen />);

        await act(async () => {
            await lastScannerProps.onScan('happier:///account?abc123');
        });

        expect(alertAsyncSpy).toHaveBeenCalledWith(
            'connect.restoreAccount',
            'connect.legacyAccountQrUnavailable',
            expect.arrayContaining([expect.objectContaining({ text: 'connect.showQrInstead' })]),
        );
        expect(routerReplaceSpy).toHaveBeenCalledWith('/settings/add-phone');
        expect(processTerminalAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('rejects scanned terminal URLs from the account scanner', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScanRoute(<Screen />);

        expect(typeof lastScannerProps?.onScan).toBe('function');

        await act(async () => {
            await lastScannerProps.onScan('happier://terminal?key=abc&server=https%3A%2F%2Fapi.happier.dev');
        });

        expect(alertAsyncSpy).toHaveBeenCalledTimes(1);
        expect(alertAsyncSpy).toHaveBeenCalledWith('common.error', 'modals.invalidAuthUrl', [{ text: 'common.ok' }]);
        expect(processTerminalAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('routes a pasted V2 Home invite as an authenticated add-for-later enrollment', async () => {
        const { buildHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { encodeBase64 } = await import('@/encryption/base64');
        const inviteLink = buildHomeQrInviteDeepLink({
            invite: {
                v: 2,
                intent: 'home_device',
                direction: 'trusted_home_displays',
                pairId: 'pair-pasted-link',
                home: {
                    v: 1,
                    homeServerIdentityId: 'srv_home_b',
                    canonicalServerUrl: 'https://home-b.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                },
                qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(11), 'base64url'),
                issuedAtMs: Date.now(),
                expiresAtMs: Date.now() + 60_000,
            },
        });
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScanRoute(<Screen />);
        await screen.pressByTestIdAsync('scan-account-enter-url');

        await act(async () => {
            screen.changeTextByTestId('restore-pairing-link-input', inviteLink);
        });
        await act(async () => {
            const submit = screen.findByTestId('restore-pairing-link-submit');
            if (!submit) throw new Error('Expected the account link form submit button');
            await submit.props.action();
        });

        const route = String(routerPushSpy.mock.calls[0]?.[0] ?? '');
        expect(route).toMatch(/^\/restore\?pairingHandoff=[A-Za-z0-9_-]+&entryIntent=add_home$/u);
        expect(route).not.toContain(encodeURIComponent(inviteLink));
    });

    it('returns to the camera from the pairing link form without leaving the route', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        const screen = await renderScanRoute(<Screen />);
        await screen.pressByTestIdAsync('scan-account-enter-url');
        await screen.pressByTestIdAsync('restore-pairing-link-back');

        expect(screen.findAllByTestId('pairing-link-entry-form')).toHaveLength(0);
        expect(screen.findAllByType('QrCodeScannerView' as never).length).toBeGreaterThan(0);
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(routerReplaceSpy).not.toHaveBeenCalled();
    });

    it('uses safe fallback navigation when cancelling without history', async () => {
        const { default: Screen } = await import('@/app/(app)/scan/account');

        await renderScanRoute(<Screen />);

        await act(async () => {
            await lastScannerProps.onCancel();
        });

        expect(routerReplaceSpy).toHaveBeenCalledWith('/');
        expect(routerBackSpy).not.toHaveBeenCalled();
    });
});
