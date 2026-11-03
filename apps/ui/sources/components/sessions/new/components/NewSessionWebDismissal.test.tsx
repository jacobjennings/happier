import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { installNewSessionComponentsCommonModuleMocks } from './newSessionComponentsTestHelpers';

const routerMock = vi.hoisted(() => ({ current: null as ReturnType<typeof createExpoRouterMock> | null }));

installNewSessionComponentsCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock: create } = await import('@/dev/testkit/mocks/router');
        routerMock.current = create({ navigation: null });
        return routerMock.current.module;
    },
});

describe('NewSessionWebDismissal', () => {
    it('leaves forced-screen web dismissal to the navigator without a modal Escape layer', async () => {
        const { storage } = await import('@/sync/domains/state/storageStore');
        const previous = storage.getState();
        storage.getState().applySettingsLocal({ newSessionPresentationModeV1: 'screen' });
        const { NewSessionWebDismissal } = await import('./NewSessionWebDismissal');
        const { dispatchEscapeToLayerStack } = await import('@/keyboard/escape');
        const screen = await renderScreen(<NewSessionWebDismissal>{React.createElement('Form')}</NewSessionWebDismissal>);
        try {
            expect(screen.findByType('Form')).toBeTruthy();
            expect(screen.findByTestId('new-session-cancel')).toBeNull();
            await act(async () => { expect(dispatchEscapeToLayerStack({ key: 'Escape' })).toBe(false); });
        } finally {
            screen.unmount();
            storage.setState(previous);
        }
    });

    it('closes the wizard from its own close control and from Escape, and lets an open picker take Escape first', async () => {
        const { NewSessionWebDismissal } = await import('./NewSessionWebDismissal');
        const { ESCAPE_LAYER_PRIORITIES, dispatchEscapeToLayerStack, useEscapeLayer, EscapeLayerProvider } = await import('@/keyboard/escape');
        const { router } = routerMock.current!.module;
        const back = routerMock.current!.spies.back;

        function Picker(): React.ReactElement {
            const layer = useEscapeLayer({ enabled: true, priority: ESCAPE_LAYER_PRIORITIES.popover, onEscape: () => true });
            return <EscapeLayerProvider layer={layer}>{React.createElement('Picker')}</EscapeLayerProvider>;
        }
        const screen = await renderScreen(<NewSessionWebDismissal>{React.createElement('Form')}</NewSessionWebDismissal>);
        expect(router).toBeTruthy();

        await screen.pressByTestIdAsync('new-session-cancel');
        expect(back).toHaveBeenCalledTimes(1);

        await act(async () => { expect(dispatchEscapeToLayerStack({ key: 'Escape' })).toBe(true); });
        expect(back).toHaveBeenCalledTimes(2);

        // A picker opened inside the wizard is a visual child: it consumes the press, the wizard stays.
        const withPicker = await renderScreen(
            <NewSessionWebDismissal><Picker /></NewSessionWebDismissal>,
        );
        await act(async () => { expect(dispatchEscapeToLayerStack({ key: 'Escape' })).toBe(true); });
        expect(back).toHaveBeenCalledTimes(2);
        withPicker.unmount?.();
    });
});
