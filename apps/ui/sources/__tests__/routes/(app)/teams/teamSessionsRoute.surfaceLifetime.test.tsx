import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Team Sessions route is a thin host of the canonical Sessions surface.
 *
 * What it owns is qualified context and surface lifetime: the Home travels in the
 * route identity so two Homes holding the same Team id never share one surface,
 * and an off-focus host stops being interactive and data-active instead of keeping
 * a second list lifecycle alive behind whatever the person opened next.
 */
const isFocusedRef = vi.hoisted(() => ({ current: true }));
const capturedSessionsListProps = vi.hoisted(() => ({ current: [] as any[] }));
const featureDecisionRef = vi.hoisted(() => ({
    current: { state: 'enabled', blockerCode: 'none' } as any,
}));
const retryFeatureProbe = vi.hoisted(() => vi.fn(async () => ({})));
const homeSelectionRef = vi.hoisted(() => ({
    current: {
        activeServerId: 'home-a',
        allowedServerIds: ['home-a', 'home-b'],
    } as { activeServerId: string; allowedServerIds: string[] },
}));

vi.mock('@react-navigation/native', async (importOriginal) => ({
    ...await importOriginal<typeof import('@react-navigation/native')>(),
    useIsFocused: () => isFocusedRef.current,
}));

vi.mock('@/components/sessions/shell/SessionsList', () => ({
    SessionsList: (props: any) => {
        capturedSessionsListProps.current.push(props);
        return null;
    },
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => featureDecisionRef.current,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: retryFeatureProbe,
}));

vi.mock('@/hooks/session/useSessionListSelectionState', () => ({
    useSessionListSelectionState: () => ({
        enabled: true,
        ...homeSelectionRef.current,
    }),
}));

vi.mock('@/hooks/teams/useTeamBinding', () => ({
    useTeamBinding: (serverId: string) => ({
        kind: 'bound',
        scope: { serverId, accountId: 'account-a' },
        address: { serverId, teamId: 'team-1' },
        homeName: serverId,
        state: {
            kind: 'ready',
            team: { name: serverId === 'home-a' ? 'Acme' : 'Globex' },
        },
        snapshot: null,
        refresh: () => {},
    }),
}));

const routeParamsRef = vi.hoisted(() => ({
    current: { teamId: 'team-1', serverId: 'home-a' } as Record<string, string>,
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const mock = createExpoRouterMock({ pathname: '/teams/team-1/sessions' }).module as any;
    return {
        ...mock,
        useLocalSearchParams: () => routeParamsRef.current,
        useNavigation: () => ({ setOptions: () => {} }),
    };
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

async function renderTeamSessionsRoute() {
    const TeamSessionsRoute = (await import('@/app/(app)/teams/[teamId]/sessions')).default;
    return renderScreen(<TeamSessionsRoute />);
}

describe('Team Sessions route', () => {
    afterEach(() => {
        capturedSessionsListProps.current = [];
        isFocusedRef.current = true;
        featureDecisionRef.current = { state: 'enabled', blockerCode: 'none' };
        homeSelectionRef.current = {
            activeServerId: 'home-a',
            allowedServerIds: ['home-a', 'home-b'],
        };
        routeParamsRef.current = { teamId: 'team-1', serverId: 'home-a' };
        retryFeatureProbe.mockClear();
        standardCleanup();
    });

    it.each([
        ['home-a', 'Acme'],
        ['home-b', 'Globex'],
    ])('hosts the canonical list under a Home-qualified route identity (%s)', async (serverId, teamDisplayName) => {
        routeParamsRef.current = { teamId: 'team-1', serverId };
        await renderTeamSessionsRoute();

        const props = capturedSessionsListProps.current.at(-1);
        expect(props).toBeDefined();
        expect(props.viewContext).toMatchObject({
            kind: 'team',
            team: { serverId, teamId: 'team-1' },
            teamDisplayName,
        });
        // The Home is in the path, so the same Team id on another Home is a
        // different surface rather than a colliding one.
        expect(props.pathname).toBe(`/teams/team-1/sessions?serverId=${serverId}`);
    });

    it('goes noninteractive and data-inactive once the surface loses focus', async () => {
        await renderTeamSessionsRoute();
        expect(capturedSessionsListProps.current.at(-1)?.surfaceOwnership).toMatchObject({
            visible: true,
            interactive: true,
            dataActive: true,
        });

        capturedSessionsListProps.current = [];
        isFocusedRef.current = false;
        await renderTeamSessionsRoute();

        expect(capturedSessionsListProps.current.at(-1)?.surfaceOwnership).toMatchObject({
            visible: false,
            interactive: false,
            dataActive: false,
        });
    });

    it.each([
        ['loading', null, 'team-sessions-listing-loading'],
        ['probe failure', { state: 'unknown', blockerCode: 'probe_failed' }, 'team-sessions-listing-probe-failed'],
        ['decided disabled', { state: 'disabled', blockerCode: 'feature_disabled' }, 'team-sessions-listing-unavailable'],
        ['decided unsupported', { state: 'unsupported', blockerCode: 'endpoint_missing' }, 'team-sessions-listing-unavailable'],
    ])('renders %s as its own state instead of the canonical list', async (_label, decision, testID) => {
        featureDecisionRef.current = decision;
        const screen = await renderTeamSessionsRoute();

        expect(screen.findByTestId(testID)).not.toBeNull();
        expect(capturedSessionsListProps.current).toEqual([]);
    });

    it('retries the exact Home feature probe after a probe failure', async () => {
        featureDecisionRef.current = { state: 'unknown', blockerCode: 'probe_failed' };
        const screen = await renderTeamSessionsRoute();

        const retry = screen.findByTestId('team-sessions-probe-retry');
        expect(retry).not.toBeNull();
        retry?.props.onPress();

        expect(retryFeatureProbe).toHaveBeenCalledWith({
            serverId: 'home-a',
            force: true,
        });
    });

    it('keeps an enabled but unmounted Home distinct from feature unavailability', async () => {
        homeSelectionRef.current = {
            activeServerId: 'home-b',
            allowedServerIds: ['home-b'],
        };

        const screen = await renderTeamSessionsRoute();

        expect(screen.findByTestId('team-sessions-home-not-mounted')).not.toBeNull();
        expect(screen.findByTestId('team-sessions-listing-unavailable')).toBeNull();
        expect(capturedSessionsListProps.current).toEqual([]);
    });
});
