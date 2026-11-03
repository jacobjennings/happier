import { describe, expect, it } from 'vitest';

import {
    buildJourneyPresentationModel,
    resolveJourneyProgressTransition,
} from './journeyPresentationModel';

describe('journeyPresentationModel', () => {
    it('exposes navigation affordances for the active beat', () => {
        expect(buildJourneyPresentationModel({ surface: 'desktop', currentBeatId: 'A1' })).toMatchObject({
            currentIndex: 0,
            currentNumber: 1,
            totalCount: 19,
            previousBeatId: null,
            nextBeatId: 'A2',
            showSkipToSetup: true,
            skipTargetBeatId: 'S1',
        });

        expect(buildJourneyPresentationModel({ surface: 'desktop', currentBeatId: 'S1' })).toMatchObject({
            currentIndex: 14,
            currentNumber: 15,
            previousBeatId: 'A14',
            nextBeatId: 'S2',
            showSkipToSetup: false,
            skipTargetBeatId: null,
        });
    });

    it('resolves advance, back, skip, and completion transitions', () => {
        expect(resolveJourneyProgressTransition({
            surface: 'desktop',
            currentBeatId: 'A2',
            action: 'advance',
        })).toEqual({ type: 'beat', beatId: 'A3' });

        expect(resolveJourneyProgressTransition({
            surface: 'desktop',
            currentBeatId: 'A13',
            action: 'advance',
        })).toEqual({ type: 'beat', beatId: 'A14' });

        expect(resolveJourneyProgressTransition({
            surface: 'desktop',
            currentBeatId: 'A2',
            action: 'back',
        })).toEqual({ type: 'beat', beatId: 'A1' });

        expect(resolveJourneyProgressTransition({
            surface: 'desktop',
            currentBeatId: 'A7',
            action: 'skipToSetup',
        })).toEqual({ type: 'beat', beatId: 'S1' });

        // The last dream beat (A14) advances into the setup act at S1.
        expect(resolveJourneyProgressTransition({
            surface: 'desktop',
            currentBeatId: 'A14',
            action: 'advance',
        })).toEqual({ type: 'beat', beatId: 'S1' });

        expect(resolveJourneyProgressTransition({
            surface: 'desktop',
            currentBeatId: 'S5',
            action: 'advance',
        })).toEqual({ type: 'complete' });

        expect(resolveJourneyProgressTransition({
            surface: 'desktop',
            currentBeatId: 'S5',
            action: 'skipToSetup',
        })).toEqual({ type: 'none' });
    });
});
