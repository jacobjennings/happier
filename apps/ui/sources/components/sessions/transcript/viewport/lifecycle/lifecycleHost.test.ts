import { describe, expect, it } from 'vitest';

import { createTranscriptLifecycleHost } from './lifecycleHost';

describe('transcript lifecycle host', () => {
    it.each([
        {
            reason: 'jump-to-seq',
            types: [
                'explicit-jump-suppress-entry-restore',
                'explicit-jump-preempt-entry-restore',
                'explicit-jump-clear-native-entry-restore-paint-release-timeout',
                'explicit-jump-invalidate-native-prepend-transaction',
                'explicit-jump-clear-native-restore-index-command-cache',
            ],
        },
        {
            reason: 'jump-to-bottom',
            types: [
                'explicit-jump-preempt-entry-restore',
                'explicit-jump-close-native-prepend-transaction',
            ],
        },
    ] as const)('groups $reason explicit jump takeover effects in lifecycle order', ({ reason, types }) => {
        const host = createTranscriptLifecycleHost();
        host.enterSession({
            platform: 'native',
            sessionId: 'session-a',
            shouldFollowLiveTail: true,
        });

        const plan = host.planExplicitJumpTakeover({
            reason,
            sessionId: 'session-a',
        });

        expect(plan.explicitJumpTakeoverEffects).toEqual(types.map((type) => ({
            reason,
            sessionId: 'session-a',
            type,
        })));
        expect(plan.lifecycleEffects).toEqual(plan.explicitJumpTakeoverEffects);
    });

    it('groups explicit return and follow-bottom intent takeover effects', () => {
        const host = createTranscriptLifecycleHost();
        const entryPlan = host.enterSession({
            platform: 'web',
            sessionId: 'session-a',
            shouldFollowLiveTail: false,
        });
        expect(entryPlan.state.bottomFollowState.mode).toBe('released');

        const returnPlan = host.planExplicitReturnToLiveTail({
            intent: 'jump-to-bottom',
            sessionId: 'session-a',
        });
        const followIntentPlan = host.planFollowBottomIntentTakeover({ sessionId: 'session-a' });

        expect(returnPlan.state.bottomFollowState.mode).toBe('following');
        expect(returnPlan.explicitReturnEffects).toEqual([
            {
                sessionId: 'session-a',
                type: 'apply-explicit-return-clear-user-scroll-intent',
            },
            {
                distanceFromLiveTailPx: 0,
                isPinned: true,
                sessionId: 'session-a',
                type: 'apply-explicit-return-to-live-tail-viewport',
            },
        ]);
        expect(followIntentPlan.followBottomIntentTakeoverEffects.map((effect) => effect.type)).toEqual([
            'follow-bottom-intent-preempt-entry-restore',
            'follow-bottom-intent-clear-user-scroll-intent',
            'follow-bottom-intent-record-live-tail-pin-offset',
        ]);
    });

    it('groups local interaction auto-pin deferral effects for the current session', () => {
        const host = createTranscriptLifecycleHost();
        host.enterSession({
            platform: 'native',
            sessionId: 'session-a',
            shouldFollowLiveTail: true,
        });

        const plan = host.planLocalInteractionIntent({
            sessionId: 'session-a',
            timestampMs: 1234,
        });

        expect(plan.localInteractionIntentEffects).toEqual([
            {
                sessionId: 'session-a',
                timestampMs: 1234,
                type: 'local-interaction-record-intent-timestamp',
            },
        ]);
    });

    it('plans standalone native touch intent effects through one host', () => {
        const host = createTranscriptLifecycleHost();
        host.enterSession({
            platform: 'native',
            sessionId: 'session-a',
            shouldFollowLiveTail: true,
        });

        const plan = host.planNativeTouchIntent({
            hasActiveNativeViewportRestore: false,
            sessionId: 'session-a',
            timestampMs: 2000,
        });

        expect(plan.nativeTouchIntentEffects).toEqual([{
            sessionId: 'session-a',
            timestampMs: 2000,
            type: 'native-touch-record-intent-timestamp',
        }]);

        const restorePlan = host.planNativeTouchIntent({
            hasActiveNativeViewportRestore: true,
            sessionId: 'session-a',
            timestampMs: 2100,
        });

        expect(restorePlan.lifecycleEffects).toEqual([]);
        expect(restorePlan.nativeTouchIntentEffects).toEqual([]);
    });

    it('groups native gesture takeover and touch release effects through one host', () => {
        const host = createTranscriptLifecycleHost();
        host.enterSession({
            platform: 'native',
            sessionId: 'session-a',
            shouldFollowLiveTail: true,
        });

        const takeoverPlan = host.planNativeGestureTakeover({
            sessionId: 'session-a',
            timestampMs: 2000,
        });
        expect(takeoverPlan.nativeUserScrollTakeoverEffects.map((effect) => effect.type)).toEqual([
            'native-user-scroll-preempt-entry-restore',
            'native-user-scroll-clear-native-initial-viewport-pending-observation',
            'native-user-scroll-record-intent-timestamp',
        ]);
        expect(takeoverPlan.nativeMomentumActiveMirrorEffects).toEqual([{
            active: false,
            sessionId: 'session-a',
            type: 'native-momentum-active-mirror',
        }]);
        expect(takeoverPlan.nativeDragActiveMirrorEffects).toEqual([{
            active: true,
            sessionId: 'session-a',
            type: 'native-drag-active-mirror',
        }]);
        const releasePlan = host.planNativeTouchRelease({
            distanceFromLiveTailPx: 180,
            pinThresholdPx: 72,
            sessionId: 'session-a',
        });
        expect(releasePlan.state.bottomFollowState.mode).toBe('released');
        expect(releasePlan.nativeTouchReleaseStateEffects).toEqual([{
            sessionId: 'session-a',
            type: 'apply-native-touch-release-live-tail-state',
        }]);
        expect(releasePlan.nativeBottomFollowRearmResetEffects).toEqual([{
            sessionId: 'session-a',
            type: 'reset-native-bottom-follow-rearm',
        }]);
    });

    it('does not re-arm renderer-owned web bottom-follow from raw trusted movement', () => {
        const host = createTranscriptLifecycleHost();
        host.enterSession({
            platform: 'web',
            sessionId: 'session-a',
            shouldFollowLiveTail: false,
        });

        // The app's own prepend-restore write got clamped by the browser to the
        // bottom (prepended rows not laid out yet), so its echo frame arrives with
        // distanceFromLiveTail 0, RN-web `isTrusted: true`, and an apparent
        // toward-live-tail delta vs the user's last upward offset — but the DOM
        // observation attests the frame did NOT move since the recorded landed
        // value (`webMovedSinceLastObservation: false`). It must not re-arm.
        const echoPlan = host.observeScroll({
            distanceFromLiveTailPx: 0,
            isTrusted: true,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: true,
            nowMs: 1000,
            pinEnabled: true,
            pinThresholdPx: 72,
            platform: 'web',
            previousScrollOffsetPx: 500,
            scrollOffsetPx: 4283,
            sessionId: 'session-a',
            wantsPinned: false,
            webMovedSinceLastObservation: false,
            webObservedUserScrollMovement: false,
        });
        expect(echoPlan.state.bottomFollowState.mode).not.toBe('following');

        // Raw trusted movement is still not semantic user movement. The ingress
        // classifier is the only owner allowed to attest a genuine renderer-owned return.
        const rawTrustedMovementPlan = host.observeScroll({
            distanceFromLiveTailPx: 0,
            isTrusted: true,
            movedAwayFromLiveTail: false,
            movedTowardLiveTail: true,
            nowMs: 2000,
            pinEnabled: true,
            pinThresholdPx: 72,
            platform: 'web',
            previousScrollOffsetPx: 4000,
            scrollOffsetPx: 4283,
            sessionId: 'session-a',
            wantsPinned: false,
            webMovedSinceLastObservation: true,
            webObservedUserScrollMovement: false,
        });
        expect(rawTrustedMovementPlan.state.bottomFollowState.mode).not.toBe('following');

    });

    it('groups session-entry lifecycle reset and viewport plans', () => {
        const host = createTranscriptLifecycleHost();

        const plan = host.enterSession({
            entryDistanceFromLiveTailPx: 96,
            platform: 'native',
            sessionId: 'session-a',
            shouldFollowLiveTail: false,
        });

        expect(plan.renderResetEffects.platform).toBe('native');
        if (plan.renderResetEffects.platform !== 'native') {
            throw new Error('expected native reset plan');
        }
        expect(plan.renderResetEffects.nativeSessionViewportReset.type)
            .toBe('session-entry-native-session-viewport-reset');
        expect(plan.renderResetEffects.commandControllerReset.openEntryTransaction).toBe(true);
        expect(plan.renderResetEffects.nativeEntrySettleReset.shouldArmConfirmation).toBe(false);
        expect(plan.viewportEffects).toEqual([{
            distanceFromLiveTailPx: 96,
            isPinned: false,
            jumpButtonDistanceFromLiveTailPx: 96,
            sessionId: 'session-a',
            shouldEmitViewportChange: true,
            shouldRestoreViewport: true,
            shouldUseEntryAnchor: true,
            type: 'apply-session-entry-viewport',
        }]);
    });
});
