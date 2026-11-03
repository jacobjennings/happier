import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { installSessionRouteCommonModuleMocks } from './sessionRouteTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockShaParam = '';
let mockServerId: string | undefined;
const routerReplaceSpy = vi.fn();
const openDetailsTabSpy = vi.fn();
const capturedPaneScopeIds: string[] = [];
const routerMock = createCommitRouteRouterMock();

function createCommitRouteRouterMock() {
    return createExpoRouterMock({
        router: {
            back: vi.fn(),
            push: vi.fn(),
            replace: routerReplaceSpy,
        },
        params: () => ({
            id: 'session-1',
            sha: mockShaParam,
            ...(mockServerId ? { serverId: mockServerId } : {}),
        }),
    });
}

installSessionRouteCommonModuleMocks({
    router: async () => routerMock.module,
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'ios',
                select: (value: any) => value?.ios ?? value?.default ?? null,
            },
            View: (props: any) => React.createElement('View', props, props.children),
            useWindowDimensions: () => ({
                width: 1400,
                height: 900,
                scale: 1,
                fontScale: 1,
            }),
        });
    },
    storageModule: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useLocalSetting: () => false,
        });
    },
});

vi.mock('@/utils/platform/responsive', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/platform/responsive')>();
    return {
        ...actual,
        useDeviceType: () => 'tablet',
        getDeviceType: () => 'tablet',
    };
});

vi.mock('@/components/ui/panels/shouldRedirectDetailsRouteToPanes', () => ({
    shouldRedirectDetailsRouteToPanes: () => false,
}));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: (scopeId: string) => {
        capturedPaneScopeIds.push(scopeId);
        return { openDetailsTab: openDetailsTabSpy };
    },
}));

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: (sessionId: string) => ({
        kind: sessionId ? 'available' : 'missing',
        sessionId,
        cause: sessionId ? undefined : 'not_found',
    }),
}));

const { default: CommitScreen } = await import('@/app/(app)/session/[id]/commit');

describe('CommitScreen native route fallback', () => {
    it('renders the invalid link fallback when the sha param is missing', async () => {
        mockShaParam = '';
        routerMock.state.params = { id: 'session-1', sha: mockShaParam };
        routerReplaceSpy.mockClear();
        openDetailsTabSpy.mockClear();
        const screen = await renderScreen(React.createElement(CommitScreen));
        try {
            await act(async () => {
                await new Promise((r) => setTimeout(r, 0));
            });

            expect(screen.findByTestId('session-invalid-link')).toBeTruthy();
            expect(routerReplaceSpy).not.toHaveBeenCalled();
            expect(openDetailsTabSpy).not.toHaveBeenCalled();
        } finally {
            act(() => {
                screen.tree.unmount();
            });
        }
    });

    it('re-opens details when the sha param changes on the same native screen instance', async () => {
        mockShaParam = 'abc123';
        routerMock.state.params = { id: 'session-1', sha: mockShaParam };
        routerReplaceSpy.mockClear();
        openDetailsTabSpy.mockClear();
        const screen = await renderScreen(React.createElement(CommitScreen));
        try {
            expect(openDetailsTabSpy).toHaveBeenCalledTimes(1);
            expect(routerReplaceSpy).toHaveBeenCalledTimes(1);
            expect(routerReplaceSpy).toHaveBeenLastCalledWith({
                pathname: '/session/[id]/details',
                params: { id: 'session-1', details: 'commit', sha: 'abc123' },
            });

            mockShaParam = 'def456';
            routerMock.state.params = { id: 'session-1', sha: mockShaParam };

            await act(async () => {
                screen.tree.update(React.createElement(CommitScreen));
            });
            await flushHookEffects({ cycles: 1, turns: 1 });

            expect(openDetailsTabSpy).toHaveBeenCalledTimes(2);
            expect(routerReplaceSpy).toHaveBeenCalledTimes(2);
            expect(routerReplaceSpy).toHaveBeenNthCalledWith(1, {
                pathname: '/session/[id]/details',
                params: { id: 'session-1', details: 'commit', sha: 'abc123' },
            });
            expect(routerReplaceSpy).toHaveBeenNthCalledWith(2, {
                pathname: '/session/[id]/details',
                params: { id: 'session-1', details: 'commit', sha: 'def456' },
            });
        } finally {
            act(() => {
                screen.tree.unmount();
            });
        }
    });

    it('opens the commit in the pane scope of the Home named by the route', async () => {
        mockShaParam = 'abc123';
        mockServerId = 'home-b';
        capturedPaneScopeIds.length = 0;
        const screen = await renderScreen(React.createElement(CommitScreen));
        try {
            expect(capturedPaneScopeIds.at(-1)).toBe('session:address:home-b:session-1');
        } finally {
            mockServerId = undefined;
            act(() => {
                screen.tree.unmount();
            });
        }
    });
});
