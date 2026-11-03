import * as React from 'react';
import { act } from 'react-test-renderer';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { installDisconnectedServerSocketBoundary, restoreServerAccountForTest } from '@/dev/testkit/harness/serverAccountConnectionHarness';
import { createPlainAccountEncryptionCurrentnessFixture } from '@/dev/testkit/fixtures/accountEncryptionCurrentness';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

installDisconnectedServerSocketBoundary();

const { storage } = await import('@/sync/domains/state/storage');
const { SessionGoalValueRow } = await import('./SessionGoalControlContent');

let connection: Awaited<ReturnType<typeof restoreServerAccountForTest>>;
let initial: ReturnType<typeof storage.getState>;

beforeEach(async () => {
    connection = await restoreServerAccountForTest({
        serverUrl: 'https://goal-row.test', serverIdentityId: 'srv_goal_row', accountId: 'account',
        request: async url => {
            const path = new URL(String(url)).pathname;
            if (path === '/v1/account/encryption') return Response.json({ mode: 'plain', updatedAt: 1 });
            if (path === '/v1/account/encryption/currentness') return Response.json(createPlainAccountEncryptionCurrentnessFixture());
            if (path === '/v2/account/settings') return Response.json({ content: null, version: 0 });
            return Response.json({}, { status: 404 });
        },
    });
    initial = storage.getState();
});

afterEach(async () => {
    await standardCleanup();
    storage.setState(initial, true);
    await connection.dispose();
});

function publishGoal(metadata: ReturnType<typeof goalMetadata> | Record<string, never>) {
    storage.setState({ sessions: { lead: createSessionFixture({
        id: 'lead', serverId: connection.home.id,
        metadata: { path: '/tmp', host: 'test', ...metadata },
    }) }, sessionListRowsByServerId: {} });
}

function goalMetadata(title: string) {
    return {
        sessionWorkStateV1: {
            v: 1,
            backendId: 'codex',
            updatedAt: 10,
            primaryItemId: 'goal:1',
            items: [{ id: 'goal:1', kind: 'goal', origin: 'vendor', status: 'active', title, updatedAt: 10 }],
        },
    };
}

describe('Work tab Goal row (lab `convo-W8full`)', () => {
    it('states the goal status and opens the Goal control through its one entry', async () => {
        publishGoal(goalMetadata('Every retry state has customer copy'));
        const open = vi.fn();
        const screen = await renderScreen(
            <SessionGoalValueRow sessionId="lead" entry={{ available: true, open }} testID="session-work-goal" />,
        );

        expect(screen.getTextContent()).toContain('session.workState.goal.statusActive');
        expect(screen.getTextContent()).not.toContain('Every retry state has customer copy');
        await act(async () => { screen.pressByTestId('session-work-goal'); });
        expect(open).toHaveBeenCalledTimes(1);
    });

    it('updates the value when the canonical goal is paused', async () => {
        publishGoal(goalMetadata('Every retry state has customer copy'));
        const entry = { available: true, open: vi.fn() };
        const screen = await renderScreen(<SessionGoalValueRow sessionId="lead" entry={entry} />);
        await act(async () => { publishGoal({
            sessionWorkStateV1: {
                ...goalMetadata('Every retry state has customer copy').sessionWorkStateV1,
                items: [{ id: 'goal:1', kind: 'goal', origin: 'vendor', status: 'paused', title: 'Every retry state has customer copy', updatedAt: 11 }],
            },
        }); });
        expect(screen.getTextContent()).toContain('session.workState.goal.statusPaused');
        expect(screen.getTextContent()).not.toContain('session.workState.goal.statusActive');
    });

    it('says the goal is not set, and is absent where the session cannot hold a goal', async () => {
        publishGoal({});
        const screen = await renderScreen(
            <SessionGoalValueRow sessionId="lead" entry={{ available: true, open: vi.fn() }} testID="session-work-goal" />,
        );
        expect(screen.getTextContent()).toContain('goalControl.row.notSet');

        const unavailable = await renderScreen(
            <SessionGoalValueRow sessionId="lead" entry={{ available: false, open: vi.fn() }} testID="session-work-goal" />,
        );
        expect(unavailable.findAllHostsByTestId('session-work-goal')).toHaveLength(0);
    });

    it('reads the same owner goal as the composer when shared metadata omits owner work', async () => {
        const goal = goalMetadata('Every retry state has customer copy');
        const ownerMetadata = { path: '/tmp', host: 'test', ...goal,
            sessionWorkStateV1: { ...goal.sessionWorkStateV1,
                items: [{ ...goal.sessionWorkStateV1.items[0]!, status: 'blocked' }] } };
        storage.setState({ sessions: { lead: createSessionFixture({
            id: 'lead', serverId: connection.home.id, metadataLayoutVersion: 1,
            metadata: { path: '/tmp', host: 'test' }, ownerMetadataView: ownerMetadata,
        }) }, sessionListRowsByServerId: {} });
        let commits = 0;
        const screen = await renderScreen(<React.Profiler id="goal" onRender={() => { commits += 1; }}>
            <SessionGoalValueRow sessionId="lead" serverId={connection.home.id}
                entry={{ available: true, open: vi.fn() }} />
        </React.Profiler>);
        expect(screen.getTextContent()).toContain('session.workState.goal.statusBlocked');
        expect(screen.getTextContent()).not.toContain('goalControl.row.notSet');
        commits = 0;
        await act(async () => {
            const lead = storage.getState().sessions.lead!;
            storage.setState({ sessions: { lead: { ...lead, thinking: !lead.thinking } } });
        });
        expect(commits).toBe(0);
    });

    it('does not read an ambient same-id Session from a different Home', async () => {
        publishGoal(goalMetadata('Every retry state has customer copy'));
        const screen = await renderScreen(<SessionGoalValueRow sessionId="lead" serverId="other-home"
            entry={{ available: true, open: vi.fn() }} />);
        expect(screen.getTextContent()).toContain('goalControl.row.notSet');
        expect(screen.getTextContent()).not.toContain('session.workState.goal.statusActive');
    });
});
