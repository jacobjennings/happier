import React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { WizardStepDots } from './WizardStepDots';

describe('WizardStepDots', () => {
    it('caps long step counts to a small visible dot window', async () => {
        const screen = await renderScreen(<WizardStepDots currentStepIndex={7} stepCount={15} />);

        expect(screen.findAllByType('Animated.View' as never)).toHaveLength(5);
        expect(screen.findByTestId('wizard-step-dots')?.props.accessibilityValue).toEqual({
            now: 8,
            min: 1,
            max: 15,
        });
    });
});
