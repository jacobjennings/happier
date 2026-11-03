import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type { SelectionListProps, SelectionListStep } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: <T,>(options: { ios?: T; native?: T; default?: T; web?: T; android?: T }) =>
                options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
        },
    });
});

function makeRootStep(): SelectionListStep {
    return {
        id: 'root',
        inputPlaceholder: 'Search',
        sections: [
            {
                kind: 'static',
                id: 'main',
                options: [
                    { id: 'create-new', label: 'Create new worktree', onSelect: () => {} },
                    { id: 'reuse', label: 'Reuse existing', onSelect: () => {} },
                ],
            },
        ],
    };
}

function defaultProps(overrides: Partial<SelectionListProps> = {}): SelectionListProps {
    return {
        rootStep: makeRootStep(),
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        keyboardHintsEnabled: false,
        disableTransitions: true,
        testID: 'sl',
        ...overrides,
    };
}

/**
 * R14 — wiring test. Before R14 the orchestrator declared
 * `quickActionShortcuts?` on `SelectionListProps` but never forwarded the
 * value to `useSelectionListKeyboardNav`. The hook test suite covered the
 * dispatch in isolation, but a parent wiring `quickActionShortcuts` got
 * silent no-ops from the orchestrator.
 *
 * This test pins the orchestrator wiring: pressing `Cmd+N` while a parent
 * configures `quickActionShortcuts: [{ shortcut: 'cmd+n', optionId: ... }]`
 * MUST activate the bound option through the orchestrator's `onSelect`.
 */
describe('SelectionList quick-action shortcut wiring (R14)', () => {
    it('forwards props.quickActionShortcuts to useSelectionListKeyboardNav so Cmd+N activates the bound option', async () => {
        const onSelect = vi.fn();
        const { act } = await import('react-test-renderer');
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(
            <SelectionList
                {...defaultProps({
                    onSelect,
                    quickActionShortcuts: [{ shortcut: 'cmd+n', optionId: 'create-new' }],
                })}
            />,
        );

        const input = screen.findByTestId('sl:header:input');
        expect(input).not.toBeNull();

        await act(async () => {
            input!.props.onKeyPress?.({
                key: 'n',
                metaKey: true,
                preventDefault: () => {},
                stopPropagation: () => {},
            });
        });

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0]?.[0]).toBe('create-new');
    });

    it('sends Cmd/Ctrl+Enter on the focused row to onCommandSelect, and plain Enter to onSelect', async () => {
        const onSelect = vi.fn();
        const onCommandSelect = vi.fn();
        const { act } = await import('react-test-renderer');
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps({ onSelect, onCommandSelect })} />);
        const input = screen.findByTestId('sl:header:input');
        const press = (event: Record<string, unknown>) => act(async () => {
            input!.props.onKeyPress?.({ key: 'Enter', preventDefault: () => {}, stopPropagation: () => {}, ...event });
        });

        await press({ metaKey: true });
        expect(onCommandSelect).toHaveBeenCalledTimes(1);
        expect(onCommandSelect.mock.calls[0]?.[0]).toBe('create-new');
        expect(onSelect).not.toHaveBeenCalled();

        await press({ ctrlKey: true });
        expect(onCommandSelect).toHaveBeenCalledTimes(2);

        await press({});
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onCommandSelect).toHaveBeenCalledTimes(2);
    });
});

