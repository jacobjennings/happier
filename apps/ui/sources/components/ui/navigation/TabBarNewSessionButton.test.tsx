import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installNavigationCommonModuleMocks } from './navigationTestHelpers';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installNavigationCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('View', props, children),
            Pressable: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('Pressable', props, children),
        });
    },
    storage: async (importOriginal) => await importOriginal(),
});

const expoRouterMock = createExpoRouterMock();

vi.mock('expo-router', () => expoRouterMock.module);

vi.mock('expo-blur', () => ({
    BlurView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('BlurView', props, children),
}));

describe('TabBarNewSessionButton', () => {
    // Load the module graph once, outside any single test's time budget.
    beforeAll(async () => {
        await import('./TabBarNewSessionButton');
    }, 300_000);

    afterEach(() => {
        standardCleanup();
        expoRouterMock.spies.push.mockReset();
    });

    it('opens an explicit ordinary-entry draft route when pressed', async () => {
        const { TabBarNewSessionButton } = await import('./TabBarNewSessionButton');

        const screen = await renderScreen(<TabBarNewSessionButton />);
        screen.pressByTestId('tabbar-start-new-session');

        expect(expoRouterMock.spies.push).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                draftId: expect.any(String),
                draftOrigin: 'ordinary',
            },
        });
    });

    it('exposes the new-session action to assistive technology', async () => {
        const { TabBarNewSessionButton } = await import('./TabBarNewSessionButton');

        const screen = await renderScreen(<TabBarNewSessionButton />);
        const button = screen.findByTestId('tabbar-start-new-session');

        // An icon-only control with no label is unusable with a screen reader, and this one has no
        // adjacent text to borrow meaning from.
        // The shared pressable exposes its role as `role` on web and `accessibilityRole` on native.
        expect(button?.props.role ?? button?.props.accessibilityRole).toBe('button');
        expect(button?.props.accessibilityLabel).toBe('newSession.title');
    });

    // The tab-bar row gives the capsule a square cell (`FloatingTabBarSurface`). The panel's
    // outermost box, the flex item that also casts the shadow, must fill that cell, and the glass
    // must fill the panel; sizing an inner box instead drew a 26x26 circle inside a 26x44 shadow.
    it('sizes the shadow host and the glass surface as one square in the tab bar row', async () => {
        const { TabBarNewSessionButton } = await import('./TabBarNewSessionButton');

        const screen = await renderScreen(<TabBarNewSessionButton />);
        const views = screen.findAllByType('View' as never);
        const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style)
            ? Object.assign({}, ...style.map(flatten))
            : (style && typeof style === 'object' ? style as Record<string, unknown> : {});

        const frame = flatten(views[0]!.props.style);
        expect(frame).toMatchObject({ flex: 1 });
        // Everything inside fills that square; nothing re-derives its own size.
        expect(views.slice(1).filter((view) => flatten(view.props.style).aspectRatio !== undefined)).toHaveLength(0);
        const surface = views.find((view) => view !== views[0] && flatten(view.props.style).borderWidth !== undefined);
        expect(flatten(surface?.props.style)).toMatchObject({ flex: 1 });
    });
});

