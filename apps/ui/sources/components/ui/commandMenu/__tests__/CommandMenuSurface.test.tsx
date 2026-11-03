import * as React from 'react';
import { View } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

import { MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS } from '@/components/ui/popover';

import { CommandMenuSurface } from '../CommandMenuSurface';
import type { CommandMenuAnchor } from '../commandMenuTypes';

type CapturedPopoverProps = React.ComponentProps<typeof import('@/components/ui/popover')['Popover']>;

const capturedPopoverProps: { current: CapturedPopoverProps | null } = { current: null };

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

// The real popover module, rendered inline at its portal/measurement boundary: this surface test
// verifies the command menu hands the canonical modal-aware portal and its keyboard-safe overrides
// to that positioning primitive.
vi.mock('@/components/ui/popover', async (importOriginal) => {
    const { createInlinePopoverModuleMock } = await import('@/dev/testkit/mocks/popover');
    return createInlinePopoverModuleMock(importOriginal, undefined, {
        onRender: (props) => {
            capturedPopoverProps.current = props;
        },
    });
});

vi.mock('@/components/ui/overlays/FloatingOverlay', () => ({
    FloatingOverlay: React.memo((props: { children: React.ReactNode }) => {
        return React.createElement(View, {}, props.children);
    }),
}));

const RECT_ANCHOR: CommandMenuAnchor = {
    kind: 'rect',
    rect: { left: 100, top: 200, height: 18 },
    coordinateSpace: 'window',
};

describe('CommandMenuSurface', () => {
    beforeEach(() => {
        capturedPopoverProps.current = null;
    });

    it('lets Popover choose the modal-aware web portal target', async () => {
        await renderScreen(
            <CommandMenuSurface
                open
                anchor={RECT_ANCHOR}
                onRequestClose={() => {}}
                testID="command-menu-surface"
            >
                <View testID="command-menu-content" />
            </CommandMenuSurface>,
        );

        expect(capturedPopoverProps.current?.portal).toBe(MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS);
    });

    it('forwards the boundary, keyboard inset, backdrop and outside-press overrides to Popover', async () => {
        // An explicit boundary (the composer passes null on web) overrides Popover's context boundary; a dropped prop falls back to it.
        const boundaryRef = React.createRef<View>();
        const backdrop = {
            style: { backgroundColor: 'transparent' },
            blockOutsidePointerEvents: 'above-anchor' as const,
        };

        await renderScreen(
            <CommandMenuSurface
                open
                anchor={RECT_ANCHOR}
                boundaryRef={boundaryRef}
                keyboardBottomInset={320}
                backdrop={backdrop}
                consumeOutsidePointerDown={false}
                onRequestClose={() => {}}
                testID="command-menu-surface"
            >
                <View testID="command-menu-content" />
            </CommandMenuSurface>,
        );

        expect(capturedPopoverProps.current?.boundaryRef).toBe(boundaryRef);
        expect(capturedPopoverProps.current?.keyboardBottomInset).toBe(320);
        expect(capturedPopoverProps.current?.backdrop).toBe(backdrop);
        expect(capturedPopoverProps.current?.consumeOutsidePointerDown).toBe(false);
    });
});
