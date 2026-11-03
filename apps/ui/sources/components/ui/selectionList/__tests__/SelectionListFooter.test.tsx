import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

describe('SelectionListFooter', () => {
    it('renders nothing when there are no hints (no host node and no rendered text)', async () => {
        const { SelectionListFooter } = await import('../SelectionListFooter');
        const screen = await renderScreen(
            <SelectionListFooter hints={[]} testID="footer-empty-marker" />,
        );
        // The composite keeps its testID prop; the footer must draw no host node.
        expect(screen.findHostByTestId('footer-empty-marker')).toBeNull();
        expect(screen.getTextContent()).toBe('');
    });

    it('renders nothing when hardware keyboard is unavailable, even with hints present', async () => {
        const { SelectionListFooter } = await import('../SelectionListFooter');
        const screen = await renderScreen(
            <SelectionListFooter
                hints={[{ id: 'enter', label: '↵', description: 'select' }]}
                hardwareKeyboardAvailable={false}
                testID="footer-no-kb-marker"
            />,
        );
        // The composite keeps its testID prop; the footer must draw no host node.
        expect(screen.findHostByTestId('footer-no-kb-marker')).toBeNull();
        expect(screen.getTextContent()).not.toContain('select');
    });

    it('renders each hint label and description when keyboard is available', async () => {
        const { SelectionListFooter } = await import('../SelectionListFooter');
        const screen = await renderScreen(
            <SelectionListFooter
                hints={[
                    { id: 'navigate', label: '↑↓', description: 'navigate' },
                    { id: 'enter', label: '↵', description: 'select' },
                ]}
                hardwareKeyboardAvailable
                testID="footer"
            />,
        );
        expect(screen.findByTestId('footer')).not.toBeNull();
        const text = screen.getTextContent();
        expect(text).toContain('navigate');
        expect(text).toContain('select');
        expect(text).toContain('↑↓');
        expect(text).toContain('↵');
    });

    it('leaves the Escape hint out of a phone-width footer so the hints keep one line', async () => {
        const { act } = await import('react-test-renderer');
        const { SelectionListFooter } = await import('../SelectionListFooter');
        const screen = await renderScreen(
            <SelectionListFooter
                hints={[
                    { id: 'move', label: '↑↓', description: 'move' },
                    { id: 'close', label: 'esc', description: 'close' },
                ]}
                hardwareKeyboardAvailable
                testID="footer"
            />,
        );
        const measure = async (width: number) => act(async () => {
            screen.findByTestId('footer')?.props.onLayout({ nativeEvent: { layout: { width } } });
        });
        await measure(640);
        expect(screen.findByTestId('footer:hint:close')).not.toBeNull();
        await measure(366);
        expect(screen.findByTestId('footer:hint:close')).toBeNull();
        expect(screen.findByTestId('footer:hint:move')).not.toBeNull();
    });
});
