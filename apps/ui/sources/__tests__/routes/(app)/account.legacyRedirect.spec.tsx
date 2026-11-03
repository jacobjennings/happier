import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import type { IModal } from '@/modal';


type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;


const routerReplaceSpy = vi.fn();
let localSearchParams: Record<string, unknown> = {};
let isAuthenticated = false;
// The person's choice in the real guidance dialog: the Modal boundary presses the matching button.
let guidanceChoice: 'showQr' | 'dismiss' = 'showQr';
const alertAsyncSpy = vi.fn<IModal['alertAsync']>(async (_title, _message, buttons) => {
    const pressed = guidanceChoice === 'showQr'
        ? buttons?.find((button) => button.style !== 'cancel' && button.onPress)
        : buttons?.find((button) => button.style === 'cancel');
    pressed?.onPress?.();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const expoRouterMock = createExpoRouterMock({
        router: { replace: routerReplaceSpy },
        params: () => localSearchParams as Record<string, string | string[] | undefined>,
    });
    return expoRouterMock.module;
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alertAsync: alertAsyncSpy } }).module;
});

vi.mock('@/auth/context/AuthContext', async () => {
    const actual = await vi.importActual<typeof import('@/auth/context/AuthContext')>('@/auth/context/AuthContext');
    return {
        ...actual,
        useAuth: () => ({ isAuthenticated }),
    };
});

const Screen = (await import('@/app/(app)/account')).default;

afterEach(() => {
    localSearchParams = {};
    isAuthenticated = false;
    guidanceChoice = 'showQr';
    routerReplaceSpy.mockClear();
    alertAsyncSpy.mockClear();
});

async function renderRoute() {
    const screen = await renderScreen(<Screen />);
    return screen;
}

describe('Legacy /account route', () => {
    it('redirects to the canonical account settings route', async () => {
        const screen = await renderRoute();
        try {
            expect(routerReplaceSpy).toHaveBeenCalledWith('/settings/account');
        } finally {
            await screen.unmount();
        }
    });

    it('preserves server override query when redirecting', async () => {
        localSearchParams = { server: 'http://localhost:3014' };
        const screen = await renderRoute();
        try {
            expect(routerReplaceSpy).toHaveBeenCalledWith({
                pathname: '/settings/account',
                params: { server: 'http://localhost:3014' },
            });
        } finally {
            await screen.unmount();
        }
    });

    it.each([
        { signedIn: true, choice: 'showQr', destination: '/settings/add-phone' },
        { signedIn: true, choice: 'dismiss', destination: '/settings/account' },
        { signedIn: false, choice: 'showQr', destination: '/restore' },
        { signedIn: false, choice: 'dismiss', destination: '/' },
    ] as const)('explains an account-connect request (signed in: $signedIn, choice: $choice) and opens $destination', async ({ signedIn, choice, destination }) => {
        isAuthenticated = signedIn;
        guidanceChoice = choice;
        localSearchParams = { accountConnectKey: 'abc+123/=', server: 'https://ignored.example' };
        const screen = await renderRoute();
        try {
            await vi.waitFor(() => expect(routerReplaceSpy).toHaveBeenCalledWith(destination));
            expect(alertAsyncSpy).toHaveBeenCalledOnce();
            expect(routerReplaceSpy).toHaveBeenCalledOnce();
        } finally {
            await screen.unmount();
        }
    });

    it('ignores array-valued account-connect keys instead of choosing an ambiguous request', async () => {
        localSearchParams = { accountConnectKey: ['first', 'second'] };
        const screen = await renderRoute();
        try {
            expect(routerReplaceSpy).toHaveBeenCalledWith('/settings/account');
            expect(alertAsyncSpy).not.toHaveBeenCalled();
        } finally {
            await screen.unmount();
        }
    });
});
