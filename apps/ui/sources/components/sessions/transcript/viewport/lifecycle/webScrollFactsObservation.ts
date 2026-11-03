import type {
    TranscriptViewportLifecycleEffect,
    TranscriptViewportLifecycleEvent,
    TranscriptViewportLifecycleTransition,
} from './lifecycle';

type WebScrollFactsObservedEvent = Extract<
    TranscriptViewportLifecycleEvent,
    { type: 'facts-observed' }
> & Readonly<{ source: 'web-scroll' }>;

type WebScrollFactsObservationDispatch = (
    event: WebScrollFactsObservedEvent
) => TranscriptViewportLifecycleTransition;

function resolveWebScrollFactsObservationEvent(params: Readonly<{
    distanceFromLiveTailPx: number;
    movedAwayFromLiveTail: boolean;
    movedTowardLiveTail: boolean;
    pinThresholdPx: number;
    sessionId: string;
}>): WebScrollFactsObservedEvent {
    return {
        distanceFromLiveTailPx: params.distanceFromLiveTailPx,
        movement: params.movedAwayFromLiveTail
            ? 'away-from-live-tail'
            : params.movedTowardLiveTail
                ? 'toward-live-tail'
                : 'none',
        pinThresholdPx: params.pinThresholdPx,
        releaseAuthority: 'web-genuine-movement',
        sessionId: params.sessionId,
        source: 'web-scroll',
        trustedUserMovement: false,
        type: 'facts-observed',
    };
}

export function resolveWebScrollFactsObservationEffects(params: Readonly<{
    dispatch: WebScrollFactsObservationDispatch;
    distanceFromLiveTailPx: number;
    movedAwayFromLiveTail: boolean;
    movedTowardLiveTail: boolean;
    pinThresholdPx: number;
    sessionId: string;
}>): readonly TranscriptViewportLifecycleEffect[] {
    return params.dispatch(resolveWebScrollFactsObservationEvent({
        distanceFromLiveTailPx: params.distanceFromLiveTailPx,
        movedAwayFromLiveTail: params.movedAwayFromLiveTail,
        movedTowardLiveTail: params.movedTowardLiveTail,
        pinThresholdPx: params.pinThresholdPx,
        sessionId: params.sessionId,
    })).effects;
}
