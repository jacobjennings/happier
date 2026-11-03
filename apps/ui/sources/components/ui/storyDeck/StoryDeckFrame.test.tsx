import React from 'react';
import { describe, expect, it } from 'vitest';

import { WizardStepDots } from '@/components/onboarding/ui/WizardStepDots';
import { renderScreen } from '@/dev/testkit';

import { StoryDeckFrame } from './StoryDeckFrame';

describe('StoryDeckFrame', () => {
    it('renders step dots for the current slide of a multi-slide deck', async () => {
        const screen = await renderScreen(
            <StoryDeckFrame currentIndex={2} totalCount={8} footer={<></>}>
                <></>
            </StoryDeckFrame>,
        );

        const dots = screen.findAllByType(WizardStepDots);
        expect(dots).toHaveLength(1);
        expect(dots[0]?.props).toMatchObject({ currentStepIndex: 2, stepCount: 8 });
    });

    it('renders no step dots for a single-slide deck', async () => {
        const screen = await renderScreen(
            <StoryDeckFrame currentIndex={0} totalCount={1} footer={<></>}>
                <></>
            </StoryDeckFrame>,
        );

        expect(screen.findAllByType(WizardStepDots)).toHaveLength(0);
    });
});
