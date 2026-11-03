import type { TranscriptViewportTelemetryObservationReason } from '@/components/sessions/transcript/scroll/transcriptViewportTelemetry';

import type { TranscriptLifecycleHostScrollObservationPlan } from './lifecycleHost';

export type TranscriptLifecycleScrollObservationPlanApplierEffects = Readonly<{
    applyGenericScrollObservationAnchorCaptureCancellationEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['genericEffects'],
    ): boolean;
    applyGenericScrollObservationReadOnlyVisibleBottomEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['genericEffects'],
    ): boolean;
    applyGenericScrollObservationSuppressionEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['genericEffects'],
    ): boolean;
    applyGenericScrollObservationViewportStateEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['genericEffects'],
        options: Readonly<{
            recordAcceptedViewportPaintObservation: () => void;
        }>,
    ): boolean;
    applyNativeAcceptedViewportPaintEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['acceptedViewportPaintEffects'],
    ): void;
    applyNativeBottomFollowCompletionEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['nativeBottomFollowCompletionEffects'],
    ): void;
    applyNativeSettledReturnToLiveTailDrainEffects(
        effects: NonNullable<TranscriptLifecycleHostScrollObservationPlan['nativeSettledReturnEffects']>['drainEffects'],
    ): void;
    applyNativeSettledReturnToLiveTailReturnEffects(
        effects: NonNullable<TranscriptLifecycleHostScrollObservationPlan['nativeSettledReturnEffects']>['returnEffects'],
    ): boolean;
    applyNativeUserScrollTakeoverEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['nativeUserScrollTakeoverEffects'],
    ): void;
    applyWebUserScrollIntentTimestampLifecycleEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['lifecycleEffects'],
    ): void;
    applyWebUserScrollTakeoverLifecycleEffects(
        effects: TranscriptLifecycleHostScrollObservationPlan['lifecycleEffects'],
    ): void;
    commitBottomFollowModeState(
        state: TranscriptLifecycleHostScrollObservationPlan['state']['bottomFollowState'],
    ): void;
    continueAfterEarlyEffects(): void;
    markNativeInitialViewportApplied(): void;
    recordNativeScrollObservation(reason: TranscriptViewportTelemetryObservationReason): void;
}>;

export function applyTranscriptLifecycleScrollObservationPlan(
    plan: TranscriptLifecycleHostScrollObservationPlan,
    effects: TranscriptLifecycleScrollObservationPlanApplierEffects,
): boolean {
    const passiveObservationEffect = plan.nativePassiveScrollObservationEffect;
    if (passiveObservationEffect) {
        effects.recordNativeScrollObservation(passiveObservationEffect.reason);
    }
    if (plan.nativeBottomFollowCompletionEffects.length > 0) {
        effects.applyNativeBottomFollowCompletionEffects(plan.nativeBottomFollowCompletionEffects);
    }
    if (plan.nativeUserScrollTakeoverEffects.length > 0) {
        effects.applyNativeUserScrollTakeoverEffects(plan.nativeUserScrollTakeoverEffects);
    }
    if (passiveObservationEffect?.markInitialViewportApplied === true) {
        effects.markNativeInitialViewportApplied();
    }
    if (passiveObservationEffect?.consumeAfterBottomCompletion === true) {
        return true;
    }

    effects.continueAfterEarlyEffects();

    effects.commitBottomFollowModeState(plan.state.bottomFollowState);
    effects.applyWebUserScrollTakeoverLifecycleEffects(plan.lifecycleEffects);
    effects.applyWebUserScrollIntentTimestampLifecycleEffects(plan.lifecycleEffects);

    let consumed = plan.disposition === 'consumed';
    const settledReturnEffects = plan.nativeSettledReturnEffects;
    if (settledReturnEffects && settledReturnEffects.returnEffects.length > 0) {
        effects.applyNativeAcceptedViewportPaintEffects(plan.acceptedViewportPaintEffects);
        if (effects.applyNativeSettledReturnToLiveTailReturnEffects(settledReturnEffects.returnEffects)) {
            effects.applyNativeSettledReturnToLiveTailDrainEffects(settledReturnEffects.drainEffects);
            consumed = true;
        }
    }

    const recordAcceptedViewportPaintObservation = () => {
        effects.applyNativeAcceptedViewportPaintEffects(plan.acceptedViewportPaintEffects);
    };
    if (effects.applyGenericScrollObservationViewportStateEffects(plan.genericEffects, {
        recordAcceptedViewportPaintObservation,
    })) {
        consumed = true;
    }
    if (effects.applyGenericScrollObservationReadOnlyVisibleBottomEffects(plan.genericEffects)) {
        consumed = true;
    }
    if (effects.applyGenericScrollObservationSuppressionEffects(plan.genericEffects)) {
        consumed = true;
    }
    if (effects.applyGenericScrollObservationAnchorCaptureCancellationEffects(plan.genericEffects)) {
        consumed = true;
    }
    return consumed;
}
