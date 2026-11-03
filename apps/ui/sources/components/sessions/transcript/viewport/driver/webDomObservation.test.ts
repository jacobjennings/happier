import { describe, expect, it } from 'vitest';

import type { WebTranscriptScrollMetrics } from '@/components/sessions/transcript/webTranscriptScrollMetrics';
import { createTranscriptUserScrollIntentOwner } from './userScrollIntentOwner';
import { createWebDomScrollObservation } from './webDomObservation';

class FakeScroller {
    public constructor(
        public scrollHeight: number,
        public clientHeight: number,
        private scrollTopValue: number = 0,
    ) {}

    public get scrollTop(): number {
        return this.scrollTopValue;
    }

    public set scrollTop(value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTopValue = Math.max(0, Math.min(value, max));
    }
}

function metrics(element: FakeScroller): WebTranscriptScrollMetrics {
    return {
        clientHeight: element.clientHeight,
        element: element as unknown as HTMLElement,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
    };
}

describe('createWebDomScrollObservation', () => {
    it('keeps interleaved user evidence for the movement after a programmatic write echo', () => {
        const observation = createWebDomScrollObservation();
        const element = new FakeScroller(1000, 400, 500);

        observation.observeGenuineScrollMovement({
            distanceFromBottom: 100,
            fallbackObservedScrollTop: null,
            isTrusted: false,
            metrics: metrics(element),
            pinThresholdPx: 72,
            semanticContext: {
                atEndNonUserCause: 'layout',
                isUserInputActive: false,
                nowMs: 1000,
            },
            sustainFrames: 2,
        });
        observation.recordProgrammaticScrollTopWrite({ element, targetScrollTop: 300 });
        observation.recordUserScrollInput({ direction: -1, nowMs: 1100 });

        const echo = observation.observeGenuineScrollMovement({
            distanceFromBottom: 300,
            fallbackObservedScrollTop: null,
            isTrusted: true,
            metrics: metrics(element),
            pinThresholdPx: 72,
            semanticContext: {
                atEndNonUserCause: 'command',
                isUserInputActive: false,
                nowMs: 1100,
            },
            sustainFrames: 2,
        });
        expect(echo).toMatchObject({
            atEndPublicationCause: 'command',
            direction: null,
            downwardIntent: false,
            isGenuineUserMovement: false,
            movedSinceLastObservation: false,
            upwardIntent: false,
        });

        element.scrollTop = 200;
        const movement = observation.observeGenuineScrollMovement({
            distanceFromBottom: 400,
            fallbackObservedScrollTop: null,
            isTrusted: true,
            metrics: metrics(element),
            pinThresholdPx: 72,
            semanticContext: {
                atEndNonUserCause: 'layout',
                isUserInputActive: false,
                nowMs: 1120,
            },
            sustainFrames: 2,
        });
        expect(movement).toMatchObject({
            atEndPublicationCause: 'user',
            direction: -1,
            isGenuineUserMovement: true,
            movedSinceLastObservation: true,
            upwardIntent: true,
        });
    });

    it('invalidates old continuation at a committed epoch while accepting direct new evidence', () => {
        const observation = createWebDomScrollObservation();
        const element = new FakeScroller(1000, 400, 200);
        const observe = (nowMs: number) => observation.observeGenuineScrollMovement({
            distanceFromBottom: Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop),
            fallbackObservedScrollTop: null,
            isTrusted: false,
            metrics: metrics(element),
            pinThresholdPx: 72,
            semanticContext: {
                atEndNonUserCause: 'layout',
                isUserInputActive: false,
                nowMs,
            },
            sustainFrames: 2,
        });

        observe(1000);
        observation.recordUserScrollInput({ direction: 1, nowMs: 1100 });
        element.scrollTop = 300;
        expect(observe(1100).atEndPublicationCause).toBe('user');

        element.scrollTop = 350;
        expect(observe(1200)).toMatchObject({
            atEndPublicationCause: 'user',
            direction: 1,
            isGenuineUserMovement: true,
        });

        observation.invalidateUserMovementAuthority();
        element.scrollTop = 400;
        expect(observe(1250)).toMatchObject({
            atEndPublicationCause: 'layout',
            direction: 1,
            isGenuineUserMovement: false,
        });

        observation.recordUserScrollInput({ direction: 1, nowMs: 1260 });
        element.scrollTop = 450;
        expect(observe(1260)).toMatchObject({
            atEndPublicationCause: 'user',
            direction: 1,
            isGenuineUserMovement: true,
        });
    });

    it('records landed programmatic writes and excludes their trusted scroll echo from user movement', () => {
        const observation = createWebDomScrollObservation();
        const element = new FakeScroller(1000, 400, 0);

        const write = observation.recordProgrammaticScrollTopWrite({
            element,
            targetScrollTop: 1000,
        });

        expect(write).toEqual({
            ok: true,
            landedScrollHeight: 1000,
            landedScrollTop: 600,
        });
        expect(observation.getState()).toMatchObject({
            observedScrollHeight: 1000,
            observedScrollTop: 600,
        });

        const echo = observation.observeGenuineScrollMovement({
            distanceFromBottom: 0,
            fallbackObservedScrollTop: 600,
            isTrusted: true,
            metrics: metrics(element),
            pinThresholdPx: 72,
            sustainFrames: 2,
        });

        expect(echo.isGenuineUserMovement).toBe(false);
        expect(echo.movedSinceLastObservation).toBe(false);
        expect(observation.getState()).toMatchObject({
            observedScrollHeight: 1000,
            observedScrollTop: 600,
        });
    });

    it('classifies a real upward web movement from the recorded write as genuine intent', () => {
        const observation = createWebDomScrollObservation();
        const element = new FakeScroller(1000, 400, 600);
        observation.recordProgrammaticScrollTopWrite({ element, targetScrollTop: 600 });
        element.scrollTop = 520;

        const movement = observation.observeGenuineScrollMovement({
            distanceFromBottom: 80,
            fallbackObservedScrollTop: 600,
            isTrusted: true,
            metrics: metrics(element),
            pinThresholdPx: 72,
            sustainFrames: 2,
        });

        expect(movement.isGenuineUserMovement).toBe(true);
        expect(movement.upwardIntent).toBe(true);
        expect(observation.getState()).toMatchObject({
            observedScrollHeight: 1000,
            observedScrollTop: 520,
        });
    });

    it('uses the current visual bottom fallback when pinned content grows from unscrollable to scrollable', () => {
        const observation = createWebDomScrollObservation();
        const element = new FakeScroller(200, 600, 0);
        observation.recordProgrammaticScrollTopWrite({ element, targetScrollTop: 200 });

        element.scrollHeight = 1200;
        element.scrollTop = 100;
        const movement = observation.observeGenuineScrollMovement({
            distanceFromBottom: 500,
            fallbackObservedScrollTop: 600,
            isTrusted: true,
            metrics: metrics(element),
            pinThresholdPx: 72,
            sustainFrames: 2,
        });

        // The growth frame itself is layout churn: a single frame landing beyond the threshold
        // during a content-height change is NOT user evidence (Legend growth bursts produce the
        // identical shape and previously false-released the pin — R3/open-drift root cause).
        // The fallback still seeds the movement ledger/streak from the visual bottom.
        expect(movement.isGenuineUserMovement).toBe(false);
        expect(movement.upwardIntent).toBe(false);
        expect(movement.movedSinceLastObservation).toBe(true);
        expect(movement.nextStreak).toEqual({ direction: -1, count: 1 });
        expect(observation.getState()).toMatchObject({
            observedScrollHeight: 1200,
            observedScrollTop: 100,
        });

        // The user's continued upward movement on the next (height-stable) frame releases.
        element.scrollTop = 40;
        const sustained = observation.observeGenuineScrollMovement({
            distanceFromBottom: 560,
            fallbackObservedScrollTop: null,
            isTrusted: false,
            metrics: metrics(element),
            pinThresholdPx: 72,
            sustainFrames: 2,
        });
        expect(sustained.isGenuineUserMovement).toBe(true);
        expect(sustained.upwardIntent).toBe(true);
    });

    it('resets observed writes and movement streak on session entry', () => {
        const observation = createWebDomScrollObservation();
        const element = new FakeScroller(1000, 400, 600);
        observation.recordProgrammaticScrollTopWrite({ element, targetScrollTop: 600 });
        element.scrollTop = 520;
        observation.observeGenuineScrollMovement({
            distanceFromBottom: 80,
            fallbackObservedScrollTop: 600,
            isTrusted: true,
            metrics: metrics(element),
            pinThresholdPx: 72,
            sustainFrames: 2,
        });

        observation.reset();

        expect(observation.getState()).toEqual({
            observedClientHeight: null,
            observedScrollHeight: null,
            observedScrollTop: null,
            streak: null,
        });
    });

    it('resets the non-programmatic movement streak when the app writes scrollTop', () => {
        const observation = createWebDomScrollObservation();
        const element = new FakeScroller(1000, 400, 600);

        element.scrollTop = 560;
        const firstMovement = observation.observeGenuineScrollMovement({
            distanceFromBottom: 40,
            fallbackObservedScrollTop: 600,
            isTrusted: false,
            metrics: metrics(element),
            pinThresholdPx: 72,
            sustainFrames: 2,
        });
        expect(firstMovement.isGenuineUserMovement).toBe(false);
        expect(observation.getState().streak).toEqual({ direction: -1, count: 1 });

        observation.recordProgrammaticScrollTopWrite({
            element,
            targetScrollTop: 580,
        });

        expect(observation.getState()).toMatchObject({
            observedScrollHeight: 1000,
            observedScrollTop: 580,
            streak: null,
        });

        element.scrollTop = 570;
        const afterWriteMovement = observation.observeGenuineScrollMovement({
            distanceFromBottom: 30,
            fallbackObservedScrollTop: 580,
            isTrusted: false,
            metrics: metrics(element),
            pinThresholdPx: 72,
            sustainFrames: 2,
        });
        expect(afterWriteMovement.isGenuineUserMovement).toBe(false);
        expect(observation.getState().streak).toEqual({ direction: -1, count: 1 });
    });

    it('revokes a stale certified movement chain through any programmatic write', () => {
        // ONE RULE FOR EVERY PROGRAMMATIC WRITER. A write relocates the reader, so once their
        // raw input has gone stale it ends the certified chain — jump, restore, entry
        // placement, resize re-pin and gap nudge alike. The one exemption this owner used to
        // carry existed for the stabilization corrector re-asserting a hold the reader already
        // owned; that writer is gone (Legend MVCP owns a parked reader), and an exemption for
        // a writer that no longer exists is a second rule for nobody.
        const runGestureAcrossWrite = (): boolean => {
            const observation = createWebDomScrollObservation();
            const element = new FakeScroller(10_000, 600, 7_000);
            observation.recordUserScrollInput({ direction: -1, nowMs: 1_000 });
            element.scrollTop = 6_900;
            const gesture = observation.observeGenuineScrollMovement({
                distanceFromBottom: 2_500,
                fallbackObservedScrollTop: 7_000,
                isTrusted: true,
                metrics: metrics(element),
                pinThresholdPx: 60,
                semanticContext: { atEndNonUserCause: 'layout', isUserInputActive: false, nowMs: 1_000 },
                sustainFrames: 2,
            });
            expect(gesture.isGenuineUserMovement).toBe(true);

            // The app writes while the reader's raw input is already stale (>320ms).
            observation.recordProgrammaticScrollTopWrite({
                element,
                targetScrollTop: 6_980,
            });

            // The same gesture's next frame: unclassified on its own, an inertia continuation
            // of the certified chain if that chain survived the write.
            element.scrollTop = 6_800;
            return observation.observeGenuineScrollMovement({
                distanceFromBottom: 2_600,
                fallbackObservedScrollTop: null,
                isTrusted: true,
                metrics: metrics(element),
                pinThresholdPx: 60,
                semanticContext: { atEndNonUserCause: 'layout', isUserInputActive: false, nowMs: 1_300 },
                sustainFrames: 2,
            }).isGenuineUserMovement;
        };

        expect(runGestureAcrossWrite()).toBe(false);
    });

    it('keeps certifying a live gesture frame after a programmatic write cleared movement authority', () => {
        // Paired positive of the stale-input revocation above. The measured failure chain: a pin
        // write during the reader's own wheel gesture wipes `pendingUserInput`/`lastUserMovement`,
        // so the NEXT frame of that same gesture is unclassified — bottom-follow is never released
        // and the auto-pin snaps the reader back.
        const observation = createWebDomScrollObservation();
        const owner = createTranscriptUserScrollIntentOwner();
        let nowMs = 1_000;

        observation.observeGenuineScrollMovement({
            distanceFromBottom: 400,
            fallbackObservedScrollTop: null,
            isTrusted: true,
            metrics: metrics(new FakeScroller(40_000, 600, 39_000)),
            pinThresholdPx: 60,
            semanticContext: { atEndNonUserCause: 'layout', isUserInputActive: false, nowMs },
            sustainFrames: 2,
        });

        owner.recordInput({ atMs: nowMs });
        // The write lands while the content already measures 40_200 (the user frame's height),
        // so the next frame is not a layout-churn frame.
        observation.recordProgrammaticScrollTopWrite({
            element: new FakeScroller(40_200, 600, 39_000),
            targetScrollTop: 39_400,
        });

        nowMs += 40;
        const userFrame = observation.observeGenuineScrollMovement({
            distanceFromBottom: 1_100,
            fallbackObservedScrollTop: null,
            isTrusted: true,
            metrics: metrics(new FakeScroller(40_200, 600, 38_500)),
            pinThresholdPx: 60,
            semanticContext: {
                atEndNonUserCause: 'layout',
                isUserInputActive: owner.isLive(nowMs),
                nowMs,
            },
            sustainFrames: 2,
        });

        expect(userFrame.isGenuineUserMovement).toBe(true);
        expect(userFrame.upwardIntent).toBe(true);
    });

    it('still refuses user authority for our own command write echo during a live gesture', () => {
        // Q1-WEB-1 must survive: RN-web marks the echo of the app's OWN programmatic write
        // `isTrusted: true`. Witnessed input is not a licence to attribute a command frame to
        // the reader, otherwise a pin under-shoot masquerades as a user scroll again.
        const observation = createWebDomScrollObservation();
        const nowMs = 1_000;

        observation.observeGenuineScrollMovement({
            distanceFromBottom: 400,
            fallbackObservedScrollTop: null,
            isTrusted: true,
            metrics: metrics(new FakeScroller(40_000, 600, 39_000)),
            pinThresholdPx: 60,
            semanticContext: { atEndNonUserCause: 'layout', isUserInputActive: true, nowMs },
            sustainFrames: 2,
        });

        const commandFrame = observation.observeGenuineScrollMovement({
            distanceFromBottom: 0,
            fallbackObservedScrollTop: null,
            isTrusted: true,
            metrics: metrics(new FakeScroller(40_000, 600, 39_400)),
            pinThresholdPx: 60,
            semanticContext: { atEndNonUserCause: 'command', isUserInputActive: true, nowMs: nowMs + 16 },
            sustainFrames: 2,
        });

        expect(commandFrame.isGenuineUserMovement).toBe(false);
        expect(commandFrame.atEndPublicationCause).toBe('command');
    });
});
