import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

describe('Eyebrow', () => {
    it('renders the label through the named eyebrow typography helper', async () => {
        const { Eyebrow } = await import('./Eyebrow');

        const screen = await renderScreen(
            <Eyebrow testID="eyebrow" accessibilityLabel="Recent sessions">
                Recent
            </Eyebrow>,
        );
        const node = screen.findByTestId('eyebrow');
        const flat = flattenStyle(node?.props.style);

        expect(node?.props.accessibilityLabel).toBe('Recent sessions');
        expect(screen.getTextContent()).toContain('Recent');

        expect(flat.textTransform).toBe('uppercase');
        expect(Number(flat.letterSpacing)).toBeGreaterThan(0);
    });
});

function flattenStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flattenStyle(entry) }), {});
    }
    if (typeof style === 'object') return style as Record<string, unknown>;
    return {};
}
