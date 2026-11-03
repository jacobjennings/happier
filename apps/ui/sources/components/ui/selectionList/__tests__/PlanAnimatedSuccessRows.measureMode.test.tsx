import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

import { PlanAnimatedSuccessRows } from '../SelectionListOptionRow';
import type { SectionRenderPlan } from '../SelectionListRenderPlan';

const plan: SectionRenderPlan = {
    id: 'dir',
    options: [{ id: 'opt-0', label: 'Option 0' }],
};

/**
 * FR3-1 / FR3-8 — every row wrapper must forward `measureMode`, otherwise the
 * hidden measure mirror duplicates option testIDs / aria identity in the live
 * tree the moment a transition-animated section is measured.
 */
function rows(measureMode: boolean): React.ReactElement {
    return (
        <PlanAnimatedSuccessRows
            plan={plan}
            rootTestID="sl"
            stepId="root"
            selectedOptionIds={new Set<string>()}
            focusedOptionId={null}
            onSelect={() => {}}
            onPushStep={() => {}}
            transitionKey="dir:/tmp"
            sectionTestId="sl:section:dir"
            measureMode={measureMode}
        />
    );
}

describe('PlanAnimatedSuccessRows measure-mode forwarding', () => {
    it('renders identity-free rows when measureMode is set', async () => {
        // Control: the live rows carry the identity the mirror must drop.
        const screen = await renderScreen(rows(false));
        expect(screen.findByTestId('sl:root:option:opt-0')).not.toBeNull();
        expect(screen.findByTestId('sl:root:option-wrapper:opt-0')).not.toBeNull();

        await screen.update(rows(true));
        expect(screen.findByTestId('sl:root:option:opt-0')).toBeNull();
        expect(screen.findByTestId('sl:root:option-wrapper:opt-0')).toBeNull();
    });
});
