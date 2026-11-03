import * as React from 'react';
import 'fake-indexeddb/auto';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createHomeGovernanceHarness } from '@/dev/testkit/harness/homeGovernanceHarness';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';

const route = vi.hoisted(() => ({
    platform: 'ios',
    canGoBack: true,
    back: vi.fn(),
    replace: vi.fn(),
    params: { draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e' },
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { get OS() { return route.platform; } } });
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
    params: route.params,
    navigation: { canGoBack: () => route.canGoBack, goBack: () => route.back() },
    router: { canGoBack: () => route.canGoBack, back: () => route.back(), replace: (...args: unknown[]) => route.replace(...args) },
    }).module;
});
vi.mock('@/sync/domains/state/browserRecordStorage', async () =>
    (await import('@/dev/testkit/mocks/browserRecordStorage')).createBrowserRecordStorageModuleMock());

await loadSyncSingletonForTests();
const homes = createHomeGovernanceHarness();
const { storage } = await import('@/sync/domains/state/storageStore');
const repository = await import('@/sync/ops/sessionDrafts/sessionDraftRepository');
const { prepareSessionDraftPersistenceStorage, discardSessionDraftPersistenceWrites } = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
const { publishAppliedActiveServerSnapshot, publishAppliedActiveServerRuntimeAvailability } = await import('@/sync/runtime/orchestration/appliedActiveServerRuntime');
const Screen = (await import('@/app/(app)/new')).default;

beforeEach(async () => {
    await prepareSessionDraftPersistenceStorage();
    repository.configureSessionDraftRepository({ syncEnabled: false });
    repository.resetSessionDraftRepositoryForTests();
    const serverId = await homes.addHome({ name: 'My Home', serverUrl: 'https://guidance.test', accountId: 'account-1', currentAccount: true });
    storage.getState().activateProfileScope({ serverId, accountId: 'account-1' });
    const { getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
    publishAppliedActiveServerSnapshot(getActiveServerSnapshot());
    storage.setState({ isSessionDraftsReady: true });
    storage.getState().applySettingsLocal({ newSessionPresentationModeV1: 'auto', useEnhancedSessionWizard: false });
    storage.getState().applyMachines([], true, { sourceServerId: serverId });
    storage.getState().markMachineListSettled(serverId);
});

afterEach(async () => {
    await standardCleanup();
    await homes.reset();
    await discardSessionDraftPersistenceWrites();
    const { clearBrowserRecords } = await import('@/sync/domains/state/browserRecordStorage');
    await clearBrowserRecords();
    repository.resetSessionDraftRepositoryForTests();
    publishAppliedActiveServerRuntimeAvailability(false);
    storage.getState().clearProfileScope();
    route.platform = 'ios';
    route.canGoBack = true;
    route.back.mockReset();
    route.replace.mockReset();
});

describe('/new blocking guidance dismissal', () => {
    it.each(['ios', 'android'])('closes the transparent %s route without starting a session', async platform => {
        route.platform = platform;
        const screen = await renderScreen(<Screen />);
        expect(screen.findByTestId('session-getting-started-scroll')).toBeTruthy();
        await screen.pressByTestIdAsync('new-session-cancel');
        expect(route.back).toHaveBeenCalledOnce();
    });

    it('returns a directly opened native route to Home', async () => {
        route.canGoBack = false;
        const screen = await renderScreen(<Screen />);
        await screen.pressByTestIdAsync('new-session-cancel');
        expect(route.replace).toHaveBeenCalledWith('/');
    });

    it.each([false, true])('closes web guidance with close and Escape (wizard: %s)', async wizard => {
        route.platform = 'web';
        route.canGoBack = false;
        storage.getState().applySettingsLocal({ useEnhancedSessionWizard: wizard });
        const screen = await renderScreen(<Screen />);
        expect(screen.findByTestId('session-getting-started-scroll')).toBeTruthy();
        await screen.pressByTestIdAsync('new-session-cancel');
        expect(route.replace).toHaveBeenCalledWith('/');
        route.replace.mockClear();
        const { dispatchEscapeToLayerStack } = await import('@/keyboard/escape');
        await act(async () => { expect(dispatchEscapeToLayerStack({ key: 'Escape' })).toBe(true); });
        expect(route.replace).toHaveBeenCalledWith('/');
    });

    it.each([{ mode: 'screen', wizard: false }, { mode: 'auto', wizard: true }] as const)(
        'leaves native $mode wizard=$wizard dismissal with the navigator', async ({ mode, wizard }) => {
            storage.getState().applySettingsLocal({ newSessionPresentationModeV1: mode, useEnhancedSessionWizard: wizard });
            const screen = await renderScreen(<Screen />);
            expect(screen.findByTestId('session-getting-started-scroll')).toBeTruthy();
            expect(screen.findByTestId('new-session-cancel')).toBeNull();
        },
    );

    it.each([false, true])('leaves forced-screen web guidance with navigator dismissal (wizard: %s)', async wizard => {
        route.platform = 'web';
        storage.getState().applySettingsLocal({ newSessionPresentationModeV1: 'screen', useEnhancedSessionWizard: wizard });
        const screen = await renderScreen(<Screen />);
        expect(screen.findByTestId('session-getting-started-scroll')).toBeTruthy();
        expect(screen.findByTestId('new-session-cancel')).toBeNull();
        const { dispatchEscapeToLayerStack } = await import('@/keyboard/escape');
        await act(async () => { expect(dispatchEscapeToLayerStack({ key: 'Escape' })).toBe(false); });
        expect(route.back).not.toHaveBeenCalled();
        expect(route.replace).not.toHaveBeenCalled();
    });
});
