import { describe, expect, it, vi } from 'vitest';

import { act, renderHook } from '@/dev/testkit';

import type {
    EditorViewportWindowRect,
    LinkBubbleState,
    MarkdownEditorCommand,
    MarkdownEditorController,
} from '../../markdownEditorTypes';
import { useMarkdownLinkBubble } from '../useMarkdownLinkBubble';

/**
 * Fake controller at the editor-surface boundary: records dispatched commands
 * and lets the test fire the link-bubble and viewport-layout callbacks the hook
 * subscribes to.
 */
function createFakeController(options: {
    measuredViewport?: EditorViewportWindowRect | null;
} = {}): MarkdownEditorController & {
    commands: MarkdownEditorCommand[];
    fireBubble: (state: LinkBubbleState | null) => void;
    fireViewportLayout: (rect: EditorViewportWindowRect | null) => void;
    hasBubbleSubscriber: () => boolean;
} {
    let bubbleCb: ((state: LinkBubbleState | null) => void) | null = null;
    let viewportCb: ((rect: EditorViewportWindowRect | null) => void) | null = null;
    const commands: MarkdownEditorCommand[] = [];

    return {
        commands,
        runCommand: (command) => {
            commands.push(command);
        },
        subscribeSelection: () => () => {},
        subscribeLinkBubble: (cb) => {
            bubbleCb = cb;
            return () => {
                bubbleCb = null;
            };
        },
        subscribeEditorViewportLayout: (cb) => {
            viewportCb = cb;
            return () => {
                viewportCb = null;
            };
        },
        measureEditorViewportInWindow: vi.fn(() => Promise.resolve(options.measuredViewport ?? null)),
        fireBubble: (state) => bubbleCb?.(state),
        fireViewportLayout: (rect) => viewportCb?.(rect),
        hasBubbleSubscriber: () => bubbleCb !== null,
    };
}

const LINK: LinkBubbleState = {
    href: 'https://github.com',
    caretRect: { left: 100, top: 200, height: 18 },
};

describe('useMarkdownLinkBubble', () => {
    it('dispatches openLink, unlink and a trimmed setLink through the controller', async () => {
        const controller = createFakeController();
        const hook = await renderHook(() => useMarkdownLinkBubble(controller));

        hook.getCurrent().onOpenLink();
        hook.getCurrent().onUnlink();
        hook.getCurrent().onSetLink('  https://example.com  ');

        expect(controller.commands).toEqual([
            { kind: 'openLink' },
            { kind: 'unlink' },
            { kind: 'setLink', href: 'https://example.com' },
        ]);

        await hook.unmount();
    });

    it('treats a blank href in onSetLink as unlink instead of writing an empty link', async () => {
        const controller = createFakeController();
        const hook = await renderHook(() => useMarkdownLinkBubble(controller));

        hook.getCurrent().onSetLink('   ');

        expect(controller.commands).toEqual([{ kind: 'unlink' }]);

        await hook.unmount();
    });

    it('opens on the link under the caret, closes when it leaves, and clears on unmount', async () => {
        const controller = createFakeController();
        const hook = await renderHook(() => useMarkdownLinkBubble(controller));
        expect(hook.getCurrent().open).toBe(false);
        expect(hook.getCurrent().href).toBe('');

        await act(async () => {
            controller.fireBubble(LINK);
        });
        expect(hook.getCurrent().open).toBe(true);
        expect(hook.getCurrent().href).toBe('https://github.com');

        await act(async () => {
            controller.fireBubble(null);
        });
        expect(hook.getCurrent().open).toBe(false);

        await hook.unmount();
        expect(controller.hasBubbleSubscriber()).toBe(false);
    });

    it('translates the caret rect into window coordinates with the subscribed viewport offset', async () => {
        const controller = createFakeController();
        const hook = await renderHook(() => useMarkdownLinkBubble(controller));

        await act(async () => {
            controller.fireViewportLayout({ left: 50, top: 80, width: 800, height: 600 });
            controller.fireBubble(LINK);
        });

        expect(hook.getCurrent().anchor).toEqual({ kind: 'rect', rect: { left: 150, top: 280, height: 18 } });

        await hook.unmount();
    });

    it('falls back to a one-shot viewport measurement before any layout event arrives', async () => {
        const controller = createFakeController({
            measuredViewport: { left: 7, top: 9, width: 320, height: 480 },
        });
        const hook = await renderHook(() => useMarkdownLinkBubble(controller));

        await act(async () => {
            controller.fireBubble(LINK);
        });

        expect(controller.measureEditorViewportInWindow).toHaveBeenCalled();
        expect(hook.getCurrent().anchor).toEqual({ kind: 'rect', rect: { left: 107, top: 209, height: 18 } });

        await hook.unmount();
    });

    it('stays dismissed after onRequestClose until the caret moves to a different link', async () => {
        const controller = createFakeController();
        const hook = await renderHook(() => useMarkdownLinkBubble(controller));

        await act(async () => {
            controller.fireBubble(LINK);
        });
        await act(async () => {
            hook.getCurrent().onRequestClose();
        });
        expect(hook.getCurrent().open).toBe(false);

        // Same link again (e.g. the caret moved within it): still dismissed.
        await act(async () => {
            controller.fireBubble({ ...LINK, caretRect: { left: 120, top: 200, height: 18 } });
        });
        expect(hook.getCurrent().open).toBe(false);

        await act(async () => {
            controller.fireBubble({ ...LINK, href: 'https://example.com' });
        });
        expect(hook.getCurrent().open).toBe(true);
        expect(hook.getCurrent().href).toBe('https://example.com');

        await hook.unmount();
    });
});
