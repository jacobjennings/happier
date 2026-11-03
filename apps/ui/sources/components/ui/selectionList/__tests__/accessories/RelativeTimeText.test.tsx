import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { flattenTestStyle, renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const NOW = 1_700_000_000_000;

describe('RelativeTimeText', () => {
    it('renders the formatted relative time string with digit widths held stable', async () => {
        const { RelativeTimeText } = await import('../../accessories/RelativeTimeText');
        const screen = await renderScreen(
            <RelativeTimeText atMs={NOW - 5 * 60_000} nowMs={NOW} testID="rt" />,
        );
        expect(screen.getTextContent()).toContain('5m ago');
        // tabular-nums keeps a ticking "5m ago" → "15m ago" from shifting its neighbours.
        expect(flattenTestStyle(screen.findByTestId('rt')?.props.style).fontVariant).toEqual(['tabular-nums']);
    });
});
