/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusReturnTarget } from '@/keyboard/focusReturn';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const actual = await vi.importActual<typeof import('react-native-web')>('react-native-web');
    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            OS: 'web',
            select: <T,>(values: { web?: T; default?: T; native?: T; ios?: T; android?: T }) => (
                values.web ?? values.default ?? values.native ?? values.ios ?? values.android
            ),
        },
    };
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

// Keep the host, resize, animation and focus ownership real; reduced motion is an OS boundary.
const { MultiPaneHostWithBottom } = await import('./MultiPaneHostWithBottom');
beforeEach(() => vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)', addEventListener() {}, removeEventListener() {},
})));

type MountedSurface = Readonly<{
    render: (input: Readonly<{
        bottomOpen: boolean;
        includeTrigger: boolean;
        bottomPresentation?: 'docked' | 'overlay';
    }>) => Promise<void>;
    captureOpeningFocus: (target: FocusReturnTarget) => void;
    unmount: () => Promise<void>;
}>;

const mountedSurfaces: MountedSurface[] = [];

afterEach(async () => {
    while (mountedSurfaces.length > 0) {
        await mountedSurfaces.pop()?.unmount();
    }
    vi.unstubAllGlobals();
});

describe('MultiPaneHostWithBottom web focus', () => {
    it('moves focus into the animated overlay, traps Tab, and restores the exact trigger', async () => {
        const surface = await mountSurface({ bottomOpen: false, includeTrigger: true });
        const trigger = requireElement<HTMLButtonElement>('bottom-focus-trigger');
        trigger.focus();
        surface.captureOpeningFocus(trigger);

        await surface.render({ bottomOpen: true, includeTrigger: true });

        const overlay = requireElement('multi-pane-bottom-overlay');
        const lastAction = requireElement<HTMLButtonElement>('bottom-focus-last-action');
        const resizeHandle = overlay.querySelector<HTMLElement>('[role="slider"]');
        expect(document.activeElement).toBe(overlay);
        expect(overlay.getAttribute('role')).toBe('dialog');
        expect(overlay.getAttribute('aria-modal')).toBe('true');
        expect(requireElement('multi-pane-bottom-underlay').hasAttribute('inert')).toBe(true);
        expect(overlay.contains(requireElement('bottom-focus-first-action'))).toBe(true);
        expect(resizeHandle).not.toBeNull();

        // The real leading resize handle participates in the same modal cycle.
        await act(async () => { lastAction.focus(); dispatchTab(); });
        expect(document.activeElement).toBe(resizeHandle);
        await act(async () => { dispatchTab(true); });
        expect(document.activeElement).toBe(lastAction);

        await surface.render({ bottomOpen: false, includeTrigger: true });
        expect(document.activeElement).toBe(trigger);
    });

    it('uses the retained pane shell when the original trigger disconnects before close', async () => {
        const surface = await mountSurface({ bottomOpen: false, includeTrigger: true });
        const trigger = requireElement<HTMLButtonElement>('bottom-focus-trigger');
        trigger.focus();
        surface.captureOpeningFocus(trigger);

        await surface.render({ bottomOpen: true, includeTrigger: true });
        const retainedUnderlay = requireElement('multi-pane-bottom-underlay');
        await surface.render({ bottomOpen: false, includeTrigger: false });

        expect(document.activeElement).toBe(retainedUnderlay);
    });

    it('discards a docked open capture before a later responsive overlay uses fallback focus', async () => {
        const surface = await mountSurface({ bottomOpen: false, includeTrigger: true });
        const trigger = requireElement<HTMLButtonElement>('bottom-focus-trigger');
        trigger.focus();
        surface.captureOpeningFocus(trigger);

        await surface.render({
            bottomOpen: true,
            includeTrigger: true,
            bottomPresentation: 'docked',
        });
        await surface.render({
            bottomOpen: true,
            includeTrigger: true,
            bottomPresentation: 'overlay',
        });

        const retainedUnderlay = requireElement('multi-pane-bottom-underlay');
        expect(document.activeElement).toBe(requireElement('multi-pane-bottom-overlay'));

        await surface.render({ bottomOpen: false, includeTrigger: true });
        expect(document.activeElement).toBe(retainedUnderlay);
        expect(document.activeElement).not.toBe(trigger);
    });
});

async function mountSurface(initialInput: Readonly<{
    bottomOpen: boolean;
    includeTrigger: boolean;
    bottomPresentation?: 'docked' | 'overlay';
}>): Promise<MountedSurface> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const openingFocusReturnRef: React.MutableRefObject<FocusReturnTarget> = { current: null };
    const surface: MountedSurface = {
        captureOpeningFocus: (target) => {
            openingFocusReturnRef.current = target;
        },
        render: async (input) => {
            await act(async () => {
                root.render(
                    <MultiPaneHostWithBottom
                        main={input.includeTrigger ? (
                            <button data-testid="bottom-focus-trigger">Trigger</button>
                        ) : null}
                        rightPane={null}
                        detailsPane={null}
                        layout={{ main: 'docked', kind: 'single', right: 'hidden', details: 'hidden' }}
                        rightDockWidthPx={360}
                        detailsDockWidthPx={520}
                        onCloseRight={() => {}}
                        onCloseDetails={() => {}}
                        onCommitRightDockWidthPx={() => {}}
                        onCommitDetailsDockWidthPx={() => {}}
                        bottomPane={input.bottomOpen ? (
                            <>
                                <button data-testid="bottom-focus-first-action">First</button>
                                <button data-testid="bottom-focus-last-action">Last</button>
                            </>
                        ) : null}
                        bottomPresentation={input.bottomPresentation ?? 'overlay'}
                        bottomDockHeightPx={320}
                        bottomDockMinHeightPx={200}
                        bottomDockMaxHeightPx={600}
                        onCloseBottom={() => {}}
                        onCommitBottomDockHeightPx={() => {}}
                        bottomOverlayFocusReturnRef={openingFocusReturnRef}
                    />,
                );
            });
        },
        unmount: async () => {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        },
    };
    mountedSurfaces.push(surface);
    await surface.render(initialInput);
    return surface;
}

function requireElement<TElement extends HTMLElement = HTMLElement>(testId: string): TElement {
    const element = document.querySelector<TElement>(`[data-testid="${testId}"]`);
    if (!element) throw new Error(`Missing ${testId}`);
    return element;
}

function dispatchTab(shiftKey = false): void {
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
    }));
}
