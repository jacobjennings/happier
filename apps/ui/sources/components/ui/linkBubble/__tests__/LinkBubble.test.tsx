import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS, Popover } from '@/components/ui/popover';
import { renderScreen } from '@/dev/testkit';

import { LinkBubble } from '../LinkBubble';
import type { LinkBubbleProps } from '../linkBubbleTypes';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

const capturedPortal: { current: React.ComponentProps<typeof Popover>['portal'] | null } = { current: null };

vi.mock('@/components/ui/popover', async (importOriginal) => {
    const { createInlinePopoverModuleMock } = await import('@/dev/testkit/mocks/popover');
    return createInlinePopoverModuleMock(importOriginal, undefined, {
        onRender: (props) => { capturedPortal.current = props.portal; },
    });
});

const DEFAULT_ANCHOR = { kind: 'rect' as const, rect: { left: 100, top: 200, height: 18 } };

function defaultProps(overrides: Partial<LinkBubbleProps> = {}): LinkBubbleProps {
    return {
        open: true,
        anchor: DEFAULT_ANCHOR,
        href: 'https://github.com',
        onOpenLink: vi.fn(),
        onUnlink: vi.fn(),
        onSetLink: vi.fn(),
        onRequestClose: vi.fn(),
        testID: 'link-bubble',
        ...overrides,
    };
}

describe('LinkBubble', () => {
    beforeEach(() => {
        capturedPortal.current = null;
    });

    it('lets Popover choose the modal-aware web portal target', async () => {
        await renderScreen(
            <LinkBubble {...defaultProps()} />,
        );

        expect(capturedPortal.current).toBe(MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS);
    });

    it('uses the markdown link bubble labels for display actions', async () => {
        const screen = await renderScreen(
            <LinkBubble {...defaultProps()} />,
        );

        expect(screen.findByTestId('link-bubble:open')?.props.accessibilityLabel)
            .toBe('markdown.linkBubble.open');
        expect(screen.findByTestId('link-bubble:edit')?.props.accessibilityLabel)
            .toBe('markdown.linkBubble.edit');
        expect(screen.findByTestId('link-bubble:unlink')?.props.accessibilityLabel)
            .toBe('markdown.linkBubble.unlink');
    });

    it('is hidden when open is false', async () => {
        const screen = await renderScreen(
            <LinkBubble {...defaultProps({ open: false })} />,
        );
        expect(screen.findByTestId('link-bubble:url')).toBeNull();
    });

    it('calls onOpenLink when the Open button is pressed', async () => {
        const onOpenLink = vi.fn();
        const screen = await renderScreen(
            <LinkBubble {...defaultProps({ onOpenLink })} />,
        );
        screen.pressByTestId('link-bubble:open');
        expect(onOpenLink).toHaveBeenCalled();
    });

    it('calls onUnlink when the Unlink button is pressed', async () => {
        const onUnlink = vi.fn();
        const screen = await renderScreen(
            <LinkBubble {...defaultProps({ onUnlink })} />,
        );
        screen.pressByTestId('link-bubble:unlink');
        expect(onUnlink).toHaveBeenCalled();
    });

    it('switches to edit mode when the Edit button is pressed', async () => {
        const screen = await renderScreen(
            <LinkBubble {...defaultProps()} />,
        );
        await screen.pressByTestIdAsync('link-bubble:edit');
        // After pressing edit, the edit input should be visible.
        expect(screen.findByTestId('link-bubble:edit-input:input')).toBeTruthy();
        // Display buttons should be hidden.
        expect(screen.findByTestId('link-bubble:open')).toBeNull();
    });

    it('calls onSetLink and exits edit mode when Save is pressed', async () => {
        const onSetLink = vi.fn();
        const screen = await renderScreen(
            <LinkBubble {...defaultProps({ onSetLink })} />,
        );
        // Enter edit mode.
        await screen.pressByTestIdAsync('link-bubble:edit');
        // Modify the input.
        await act(async () => {
            screen.changeTextByTestId('link-bubble:edit-input:input', 'https://new.com');
        });
        // Save.
        await screen.pressByTestIdAsync('link-bubble:edit-input:save');
        expect(onSetLink).toHaveBeenCalledWith('https://new.com');
        // Should be back in display mode.
        expect(screen.findByTestId('link-bubble:edit-input:input')).toBeNull();
    });

    it('exits edit mode without calling onSetLink when Cancel is pressed', async () => {
        const onSetLink = vi.fn();
        const screen = await renderScreen(
            <LinkBubble {...defaultProps({ onSetLink })} />,
        );
        // Enter edit mode.
        await screen.pressByTestIdAsync('link-bubble:edit');
        // Cancel.
        await screen.pressByTestIdAsync('link-bubble:edit-input:cancel');
        expect(onSetLink).not.toHaveBeenCalled();
        // Should be back in display mode.
        expect(screen.findByTestId('link-bubble:edit-input:input')).toBeNull();
    });

    it('displays the full URL text', async () => {
        const screen = await renderScreen(
            <LinkBubble {...defaultProps({ href: 'https://github.com/happier' })} />,
        );
        const text = screen.getTextContent();
        expect(text).toContain('https://github.com/happier');
    });

    it('truncates long URLs with an ellipsis', async () => {
        const longUrl = 'https://example.com/a-very-long-path-that-exceeds-the-maximum-display-length-for-the-bubble';
        const screen = await renderScreen(
            <LinkBubble {...defaultProps({ href: longUrl })} />,
        );
        const text = screen.getTextContent();
        expect(text).toContain(`${longUrl.slice(0, 50)}…`);
        expect(text).not.toContain(longUrl);
    });
});
