export type NativeScrollAwayGestureLiveTailBailDecision =
    | Readonly<{ type: 'bail' }>
    | Readonly<{
        reason:
            | 'no-open-trusted-away-gesture'
            | 'outside-live-tail-threshold'
            | 'trusted-observation';
        type: 'continue';
    }>;

export function resolveNativeScrollAwayGestureLiveTailBailDecision(params: Readonly<{
    distanceFromLiveTailPx: number;
    hasOpenTrustedAwayGesture: boolean;
    isTrusted: boolean;
    pinThresholdPx: number;
}>): NativeScrollAwayGestureLiveTailBailDecision {
    if (!params.hasOpenTrustedAwayGesture) {
        return { reason: 'no-open-trusted-away-gesture', type: 'continue' };
    }
    if (params.isTrusted) return { reason: 'trusted-observation', type: 'continue' };
    if (params.distanceFromLiveTailPx <= params.pinThresholdPx) return { type: 'bail' };
    return { reason: 'outside-live-tail-threshold', type: 'continue' };
}

export type NativeScrollAwayGestureLiveTailBailEffect =
    | Readonly<{
        distanceFromLiveTailPx: number;
        isTrusted: boolean;
        movedAwayFromLiveTail: boolean;
        movedTowardLiveTail: boolean;
        recentUserIntent: boolean;
        sessionId: string;
        type: 'observe-native-scroll-facts';
    }>
    | Readonly<{
        sessionId: string;
        type: 'consume-observation';
    }>;

export function resolveNativeScrollAwayGestureLiveTailBailEffects(params: Readonly<{
    decision: NativeScrollAwayGestureLiveTailBailDecision;
    distanceFromLiveTailPx: number;
    isTrusted: boolean;
    movedAwayFromLiveTail: boolean;
    movedTowardLiveTail: boolean;
    nativeListDragActive: boolean;
    recentUserIntent: boolean;
    sessionId: string;
}>): readonly NativeScrollAwayGestureLiveTailBailEffect[] {
    if (params.decision.type !== 'bail') return [];

    const effects: NativeScrollAwayGestureLiveTailBailEffect[] = [];

    if (params.nativeListDragActive) {
        effects.push({
            distanceFromLiveTailPx: params.distanceFromLiveTailPx,
            isTrusted: params.isTrusted,
            movedAwayFromLiveTail: params.movedAwayFromLiveTail,
            movedTowardLiveTail: params.movedTowardLiveTail,
            recentUserIntent: params.recentUserIntent,
            sessionId: params.sessionId,
            type: 'observe-native-scroll-facts',
        });
    }

    effects.push({
        sessionId: params.sessionId,
        type: 'consume-observation',
    });
    return effects;
}
