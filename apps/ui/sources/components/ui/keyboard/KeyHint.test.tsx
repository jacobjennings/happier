import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

describe('KeyHint', () => {
    it('renders a decorative keyboard hint without press handlers', async () => {
        const { KeyHint } = await import('./KeyHint');

        const screen = await renderScreen(<KeyHint label="⌘N" testID="key-hint" />);
        const node = screen.findByTestId('key-hint');

        expect(node).not.toBeNull();
        expect(node?.props.accessibilityLabel).toBe('⌘N');
        expect(node?.props.onPress).toBeUndefined();
        expect(screen.getTextContent()).toContain('⌘N');
    });

    it('draws arrows, Return and Escape as their keycap faces wherever a key is shown (shortcut sheet KB1)', async () => {
        const { KeyHint } = await import('./KeyHint');

        const screen = await renderScreen(<>
            <KeyHint label="ArrowDown" testID="down" />
            <KeyHint label="Enter" testID="enter" />
            <KeyHint label="Escape" testID="escape" />
        </>);

        expect(screen.findByTestId('down:label')?.props.children).toBe('↓');
        expect(screen.findByTestId('enter:label')?.props.children).toBe('↵');
        expect(screen.findByTestId('escape:label')?.props.children).toBe('Esc');
    });

    it('renders nothing when disabled', async () => {
        const { KeyHint } = await import('./KeyHint');

        const screen = await renderScreen(<KeyHint label="esc-disabled-marker" enabled={false} testID="key-disabled" />);

        expect(screen.getTextContent()).not.toContain('esc-disabled-marker');
    });
});
