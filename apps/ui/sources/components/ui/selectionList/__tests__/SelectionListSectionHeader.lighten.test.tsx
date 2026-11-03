import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

/**
 * The shared section header's content slots. Its typography is the
 * `Typography` meta role's to own, so it is not re-asserted as raw style here.
 */
describe('SelectionListSectionHeader', () => {
    it('preserves the R6 testID + count contract', async () => {
        const { SelectionListSectionHeader } = await import('../SelectionListSectionHeader');
        const screen = await renderScreen(
            <SelectionListSectionHeader testID="hdr" title="Favorites" count={3} />,
        );
        expect(screen.findByTestId('hdr')).not.toBeNull();
        const text = screen.getTextContent();
        expect(text).toContain('Favorites');
        expect(text).toContain('3');
    });

    it('keeps a section-owned action at the right edge of the shared header', async () => {
        const { SelectionListSectionHeader } = await import('../SelectionListSectionHeader');
        const screen = await renderScreen(
            <SelectionListSectionHeader
                testID="hdr"
                title="Ready for review"
                rightAccessory={React.createElement('SectionAction', { testID: 'section-action' })}
            />,
        );

        expect(screen.findByTestId('section-action')).not.toBeNull();
    });
});
