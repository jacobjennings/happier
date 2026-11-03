import * as React from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryWriteServerEnabledBitInPlace } from '@happier-dev/protocol/features/serverEnabledBit';
import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { buildServerFeaturesResponse } from '@/hooks/server/serverFeaturesTestUtils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const followControlSpy = vi.hoisted(() => vi.fn());
/** What the Home's feature probe answers; 'pending' never resolves (the decision has not arrived). */
const probe = vi.hoisted(() => ({ answer: 'ready' as 'ready' | 'disabled' | 'unsupported' | 'unreachable' | 'pending' }));
const getServerFeaturesSnapshot = vi.hoisted(() => vi.fn());

vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock({
    params: { id: 's1', serverId: 'home-a' },
    router: {
        push: vi.fn(),
        back: vi.fn(),
        replace: vi.fn(),
        setParams: vi.fn(),
    },
}).module);

// The probe is the genuine system boundary; the real feature decision runs on its answer.
vi.mock('@/sync/api/capabilities/serverFeaturesClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/serverFeaturesClient')>(),
    getServerFeaturesSnapshot,
}));

vi.mock('@/components/sessions/follow/AccountSessionFollowControl', () => ({
    AccountSessionFollowControl: (props: unknown) => followControlSpy(props),
}));

describe('direct session Follow route', () => {
    beforeEach(() => {
        followControlSpy.mockClear();
        getServerFeaturesSnapshot.mockClear();
        probe.answer = 'ready';
        getServerFeaturesSnapshot.mockImplementation(async () => {
            if (probe.answer === 'pending') return await new Promise(() => {});
            if (probe.answer === 'unreachable') return { status: 'error', reason: 'network' };
            if (probe.answer === 'unsupported') return { status: 'unsupported', reason: 'endpoint_missing' };
            const features = buildServerFeaturesResponse();
            if (!tryWriteServerEnabledBitInPlace(features, 'sessions.following', probe.answer === 'ready')) {
                throw new Error('Unable to write sessions.following');
            }
            return { status: 'ready', features };
        });
    });

    afterEach(() => {
        standardCleanup();
    });

    async function renderFollowRoute() {
        const { default: FollowRoute } = await import('@/app/(app)/session/[id]/follow');
        const screen = await renderScreen(<FollowRoute />);
        await flushHookEffects();
        return screen;
    }

    it('mounts the Follow control on a Home that offers Following', async () => {
        const screen = await renderFollowRoute();

        expect(followControlSpy).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('session-follow-unavailable')).toBeNull();
    });

    it.each([
        ['while the decision has not arrived', 'pending', 'session-follow-checking'],
        ['when the probe could not reach the Home', 'unreachable', 'session-follow-unreachable'],
    ] as const)(
        'shows the %s state on the dedicated route instead of nothing',
        async (_name, answer, testID) => {
            probe.answer = answer;

            const screen = await renderFollowRoute();

            // A deep link that lands on a blank screen reads as a broken link. The route
            // says what is happening and keeps the way back to the Session it named.
            expect(followControlSpy).not.toHaveBeenCalled();
            expect(screen.findByTestId(testID)).not.toBeNull();
            expect(screen.findByTestId('session-follow-unavailable')).toBeNull();
        },
    );

    it('offers the canonical feature probe again when it could not reach the Home', async () => {
        probe.answer = 'unreachable';
        const screen = await renderFollowRoute();
        const retry = screen.findByTestId('session-follow-unreachable.retry');
        expect(retry).not.toBeNull();
        getServerFeaturesSnapshot.mockClear();
        await screen.pressByTestIdAsync('session-follow-unreachable.retry');

        expect(getServerFeaturesSnapshot).toHaveBeenCalledWith({ serverId: 'home-a', force: true });
    });

    it.each(['disabled', 'unsupported'] as const)(
        'answers a %s Following Home instead of rendering a blank screen',
        async (answer) => {
            probe.answer = answer;

            const screen = await renderFollowRoute();

            // The control renders nothing when Following is unavailable; on this dedicated
            // route that reads as a broken link rather than an answer.
            expect(followControlSpy).not.toHaveBeenCalled();
            expect(screen.findByTestId('session-follow-unavailable')).not.toBeNull();
            expect(screen.findByTestId('session-follow-unavailable.back')).not.toBeNull();
        },
    );
});
