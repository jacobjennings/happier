import * as React from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const openDetailsTabSpy = vi.hoisted(() => vi.fn());
const routerReplaceSpy = vi.hoisted(() => vi.fn());
const capturedScopeIdRef = vi.hoisted(() => ({ current: '' }));
const paneScopeMock = vi.hoisted(() => ({
    openDetailsTab: openDetailsTabSpy,
    closeDetailsTab: vi.fn(),
    closeDetails: vi.fn(),
    pinDetailsTab: vi.fn(),
    setActiveDetailsTab: vi.fn(),
    setRightTab: vi.fn(),
    setRightTabState: vi.fn(),
    closeRight: vi.fn(),
    scopeState: { details: { isOpen: false, tabs: [] } },
}));

let routeParams: Record<string, string | string[]> = { id: ['s1', 's2'], path: 'src/a.txt', serverId: 'home-b' };

const routerMock = createExpoRouterMock({
    params: () => routeParams,
    router: {
        push: vi.fn(),
        back: vi.fn(),
        replace: routerReplaceSpy,
        setParams: vi.fn(),
    },
});

vi.mock('expo-router', () => routerMock.module);

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
        useWindowDimensions: () => ({ width: 1024, height: 768 }),
    });
});

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: (scopeId: string) => {
        capturedScopeIdRef.current = scopeId;
        return {
            ...paneScopeMock,
        };
    },
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: (props: any) => React.createElement('SessionFileDetailsView', props),
}));

vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: (sessionId: string) => ({ kind: 'available', sessionId }),
}));

vi.mock('@/components/ui/panels/shouldRedirectDetailsRouteToPanes', () => ({
    shouldRedirectDetailsRouteToPanes: () => false,
}));

vi.mock('@/utils/platform/responsive', () => ({
    useDeviceType: () => 'phone',
}));

const storageMock = createStorageModuleStub({
    useLocalSetting: (key: string) => (key === 'uiMultiPanePanelsEnabled' ? false : undefined),
});

vi.mock('@/sync/domains/state/storage', () => storageMock);

describe('session file route', () => {
    beforeEach(() => {
        openDetailsTabSpy.mockClear();
        routerReplaceSpy.mockClear();
        routeParams = { id: ['s1', 's2'], path: 'src/a.txt', serverId: 'home-b' };
    });

    afterEach(() => {
        standardCleanup();
    });

    it('normalizes array session ids before opening the file details pane', async () => {
        const { default: FileRoute } = await import('@/app/(app)/session/[id]/file');

        await renderScreen(<FileRoute />);

        expect(openDetailsTabSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'file:src/a.txt',
                kind: 'file',
                title: 'a.txt',
                resource: expect.objectContaining({
                    kind: 'file',
                    path: 'src/a.txt',
                }),
            }),
            expect.objectContaining({ intent: 'preview' }),
        );
        expect(capturedScopeIdRef.current).toBe('session:address:home-b:s1');
        expect(routerReplaceSpy).toHaveBeenCalledWith({
            pathname: '/session/[id]/details',
            params: expect.objectContaining({ id: 's1', serverId: 'home-b', details: 'file', path: 'src/a.txt' }),
        });
    });

    it('re-opens details when the file path param changes on the same native screen instance', async () => {
        const { default: FileRoute } = await import('@/app/(app)/session/[id]/file');
        routeParams = { id: 's1', path: 'a.txt', serverId: 'home-b' };

        const screen = await renderScreen(<FileRoute />);
        expect(openDetailsTabSpy).toHaveBeenCalledTimes(1);
        expect(routerReplaceSpy).toHaveBeenCalledTimes(1);

        routeParams = { id: 's1', path: 'b.txt', serverId: 'home-b' };
        await screen.update(<FileRoute />);
        await flushHookEffects();

        expect(openDetailsTabSpy).toHaveBeenCalledTimes(2);
        expect(routerReplaceSpy).toHaveBeenCalledTimes(2);
        expect(routerReplaceSpy).toHaveBeenNthCalledWith(1, {
            pathname: '/session/[id]/details',
            params: expect.objectContaining({ id: 's1', details: 'file', path: 'a.txt' }),
        });
        expect(routerReplaceSpy).toHaveBeenNthCalledWith(2, {
            pathname: '/session/[id]/details',
            params: expect.objectContaining({ id: 's1', details: 'file', path: 'b.txt' }),
        });
    });
});
