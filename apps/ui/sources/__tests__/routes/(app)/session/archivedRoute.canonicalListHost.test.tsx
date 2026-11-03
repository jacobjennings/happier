import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { UniversalSearchRuntimeProvider } from '@/components/appShell/search/UniversalSearchRuntimeContext';
import { installSessionShellCommonModuleMocks } from '@/components/sessions/shell/sessionShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshSessions: vi.fn(async () => {}),
        markSessionListScrollActivity: vi.fn(),
    },
}));

vi.mock('@react-navigation/native', async (importOriginal) => ({
    ...await importOriginal<typeof import('@react-navigation/native')>(),
    useIsFocused: () => true,
}));

vi.mock('@/auth/context/AuthContext', () => ({
    getCurrentAuth: () => null,
    useAuth: () => ({ refreshFromActiveServer: async () => undefined }),
}));

// The row tree is the list's presentation. This suite is about which surface and
// which corpus the route hosts, so the virtualized content is stubbed while the
// real view state, filter controller and pagination owner all run.
const capturedVirtualizedProps = vi.hoisted(() => ({ current: null as any }));
const capturedPagingInput = vi.hoisted(() => ({ current: null as any }));

vi.mock('@/sync/domains/session/listing/useSessionListQuerySourceState', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/session/listing/useSessionListQuerySourceState')>();
    return {
        ...actual,
        useSessionListQuerySourceState: (input: any) => {
            capturedPagingInput.current = input;
            return {
                statesByServerId: {},
                byServerId: {},
                source: null,
                coverageComplete: false,
                loadNext: async () => {},
                refresh: async () => {},
            };
        },
    };
});
vi.mock('@/components/sessions/shell/sessionListVirtualizedContent', () => ({
    SESSION_LIST_FILTERED_NO_RESULTS_MESSAGE_KEY: 'sessionsList.filteredNoResults',
    SessionListVirtualizedContent: (props: any) => {
        capturedVirtualizedProps.current = props;
        return null;
    },
}));

installSessionShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
        return createExpoRouterMock({
            pathname: '/session/archived',
            navigation: createReactNavigationNativeMock().useNavigation(),
        }).module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async (importOriginal) => await importOriginal(),
});

async function renderArchivedRoute() {
    const ArchivedSessionsScreen = (await import('@/app/(app)/session/archived')).default;
    return renderScreen(
        <UniversalSearchRuntimeProvider value={{ open: () => {}, buildCommands: () => [] } as never}>
            <ArchivedSessionsScreen />
        </UniversalSearchRuntimeProvider>,
    );
}

describe('archived Sessions route', () => {
    afterEach(() => {
        capturedVirtualizedProps.current = null;
        capturedPagingInput.current = null;
        standardCleanup();
    });

    it('hosts the canonical Sessions list and routes the archived corpus through the per-Home paging owner', async () => {
        await renderArchivedRoute();

        // The canonical list surface rendered: the route no longer builds its own
        // section list, cards, grouping or unarchive button.
        expect(capturedVirtualizedProps.current).not.toBeNull();
        expect(capturedPagingInput.current?.enabled).toBe(true);
        const homes = capturedPagingInput.current?.homes ?? [];
        expect(homes.length).toBeGreaterThan(0);
        for (const home of homes) {
            expect(home.query.storage).toBe('archived');
            // Archived rows are inactive by definition, so the active list's
            // hide-inactive preference must not narrow this corpus.
            expect(home.query.includeInactive).toBe(true);
            expect(home.ordinaryAdapter).toEqual({
                path: '/v2/sessions/archived',
                allowV1Fallback: false,
                membership: 'archived',
            });
        }
    });

    it('keeps synchronized drafts out of the archived corpus', async () => {
        await renderArchivedRoute();

        expect(capturedVirtualizedProps.current?.showDrafts).toBe(false);
    });
});
