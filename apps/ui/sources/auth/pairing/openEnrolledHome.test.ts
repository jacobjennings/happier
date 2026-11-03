import { describe, expect, it, vi } from 'vitest';

const switchResults: string[] = [];
const alertCalls: Array<{ title: string; body: string }> = [];

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            alertAsync: (async (title: string, body: string, buttons?: ReadonlyArray<{ text: string; onPress?: () => void }>) => {
                alertCalls.push({ title, body });
                buttons?.find((button) => button.text === 'common.cancel')?.onPress?.();
            }) as never,
        },
    }).module;
});
vi.mock('@/text', async () => {
    const { installTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return installTextModuleMock()();
});
vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: vi.fn(async () => switchResults.shift() ?? 'blocked'),
}));

describe('openEnrolledHomeOrReturnToShell', () => {
    it('reports a failed open with its own copy instead of the add-succeeded copy', async () => {
        alertCalls.length = 0;
        switchResults.length = 0;
        switchResults.push('blocked');

        const { openEnrolledHomeOrReturnToShell } = await import('./openEnrolledHome');
        const result = await openEnrolledHomeOrReturnToShell({
            profileId: 'profile-a',
            targetLabel: 'Home A',
            isCurrent: () => true,
            refreshAuth: vi.fn(async () => {}),
        });

        expect(result).toBe('returned_to_shell');
        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0].body).not.toBe('connect.homeAddedPreservedFocusBody');
        expect(alertCalls[0].body).toBe('connect.homeSavedOpenFailedBody');
    });

    it('opens without any notice when the focus switch succeeds', async () => {
        alertCalls.length = 0;
        switchResults.length = 0;
        switchResults.push('switched');

        const { openEnrolledHomeOrReturnToShell } = await import('./openEnrolledHome');
        const result = await openEnrolledHomeOrReturnToShell({
            profileId: 'profile-a',
            targetLabel: 'Home A',
            isCurrent: () => true,
            refreshAuth: vi.fn(async () => {}),
        });

        expect(result).toBe('opened');
        expect(alertCalls).toHaveLength(0);
    });

    it('offers the open retry when the already-focused Home cannot refresh its credential', async () => {
        alertCalls.length = 0;
        switchResults.length = 0;
        switchResults.push('already_active');

        const { openEnrolledHomeOrReturnToShell } = await import('./openEnrolledHome');
        const result = await openEnrolledHomeOrReturnToShell({
            profileId: 'profile-a',
            targetLabel: 'Home A',
            isCurrent: () => true,
            refreshAuth: vi.fn(async () => {
                throw new Error('refresh failed');
            }),
        });

        expect(result).toBe('returned_to_shell');
        expect(alertCalls).toEqual([{ title: 'Home A', body: 'connect.homeSavedOpenFailedBody' }]);
    });
});
