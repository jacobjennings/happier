import * as React from 'react';

const DEFAULT_HOSTED_FRAME_READY_TIMEOUT_MS = 30_000;

function scheduleHostedFrameReadyTimeout(input: Readonly<{
    timeoutMs?: number;
    onTimeout: () => void;
}>): () => void {
    const timeout = setTimeout(input.onTimeout, input.timeoutMs ?? DEFAULT_HOSTED_FRAME_READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
}

export type HostedFrameFailure =
    | 'guest_error'
    | 'load_failed'
    | 'ready_timeout'
    | 'unexpected_navigation';

export type HostedFrameRetirementReason = HostedFrameFailure | 'reload' | 'replaced' | 'retired' | 'unmount';

type HostedFrameLifecycleState = Readonly<{
    lifetimeKey: string;
    attempt: number;
    loaded: boolean;
    ready: boolean;
    failure: HostedFrameFailure | null;
}>;

/** One source-neutral frame attempt lifecycle shared by installed and caller adapters. */
export function useHostedFrameLifecycle(input: Readonly<{
    lifetimeKey: string;
    readyRequired: boolean;
    readyTimeoutMs?: number | null;
    onReadyTimeout?: () => void;
    onRetireAttempt?: (reason: HostedFrameRetirementReason) => void;
}>) {
    const [state, setState] = React.useState<HostedFrameLifecycleState>(() => ({
        lifetimeKey: input.lifetimeKey,
        attempt: 0,
        loaded: false,
        ready: false,
        failure: null,
    }));
    const onReadyTimeoutRef = React.useRef(input.onReadyTimeout);
    const onRetireAttemptRef = React.useRef(input.onRetireAttempt);
    onReadyTimeoutRef.current = input.onReadyTimeout;
    onRetireAttemptRef.current = input.onRetireAttempt;
    const renderedState = state.lifetimeKey === input.lifetimeKey
        ? state
        : { lifetimeKey: input.lifetimeKey, attempt: 0, loaded: false, ready: false, failure: null };
    if (renderedState !== state) setState(renderedState);
    const attemptKey = `${renderedState.lifetimeKey}\u001f${renderedState.attempt}`;
    const activeAttemptKeyRef = React.useRef(attemptKey);
    activeAttemptKeyRef.current = attemptKey;
    const retiredAttemptKeyRef = React.useRef<string | null>(null);
    const retireAttempt = React.useCallback((key: string, reason: HostedFrameRetirementReason) => {
        if (retiredAttemptKeyRef.current === key) return false;
        retiredAttemptKeyRef.current = key;
        onRetireAttemptRef.current?.(reason);
        return true;
    }, []);
    const retireIfCurrent = React.useCallback((key: string, reason: HostedFrameRetirementReason) => (
        activeAttemptKeyRef.current === key && retireAttempt(key, reason)
    ), [retireAttempt]);
    const committedAttemptKeyRef = React.useRef(attemptKey);

    React.useLayoutEffect(() => {
        const previousAttemptKey = committedAttemptKeyRef.current;
        committedAttemptKeyRef.current = attemptKey;
        if (previousAttemptKey !== attemptKey) retireAttempt(previousAttemptKey, 'replaced');
    }, [attemptKey, retireAttempt]);

    React.useLayoutEffect(() => () => {
        const key = activeAttemptKeyRef.current;
        if (retiredAttemptKeyRef.current === key) return;
        retiredAttemptKeyRef.current = key;
        onRetireAttemptRef.current?.('unmount');
    }, []);

    const fail = React.useCallback((reason: HostedFrameFailure) => {
        if (!retireIfCurrent(attemptKey, reason)) return;
        setState((current) => current.lifetimeKey === renderedState.lifetimeKey && current.attempt === renderedState.attempt
            ? { ...current, failure: current.failure ?? reason }
            : current);
    }, [attemptKey, renderedState.attempt, renderedState.lifetimeKey, retireIfCurrent]);
    const reload = React.useCallback(() => {
        if (activeAttemptKeyRef.current !== attemptKey) return;
        retireIfCurrent(attemptKey, 'reload');
        setState((current) => current.lifetimeKey === renderedState.lifetimeKey && current.attempt === renderedState.attempt
            ? { ...current, attempt: current.attempt + 1, loaded: false, ready: false, failure: null }
            : current);
    }, [attemptKey, renderedState.attempt, renderedState.lifetimeKey, retireIfCurrent]);
    const retire = React.useCallback(() => {
        retireAttempt(attemptKey, 'retired');
    }, [attemptKey, retireAttempt]);
    const markLoaded = React.useCallback(() => {
        setState((current) => current.lifetimeKey === renderedState.lifetimeKey && current.attempt === renderedState.attempt
            && current.failure === null ? { ...current, loaded: true } : current);
    }, [renderedState.attempt, renderedState.lifetimeKey]);
    const markReady = React.useCallback(() => {
        setState((current) => current.lifetimeKey === renderedState.lifetimeKey && current.attempt === renderedState.attempt
            && current.failure === null ? { ...current, ready: true } : current);
    }, [renderedState.attempt, renderedState.lifetimeKey]);

    React.useEffect(() => {
        if (!renderedState.loaded || renderedState.ready || renderedState.failure || !input.readyRequired || input.readyTimeoutMs === null) return;
        return scheduleHostedFrameReadyTimeout({
            timeoutMs: input.readyTimeoutMs ?? undefined,
            onTimeout: () => {
                onReadyTimeoutRef.current?.();
                fail('ready_timeout');
            },
        });
    }, [fail, input.readyRequired, input.readyTimeoutMs, renderedState.failure, renderedState.loaded, renderedState.ready]);

    return Object.freeze({
        attempt: renderedState.attempt,
        loaded: renderedState.loaded,
        ready: renderedState.ready,
        failure: renderedState.failure,
        fail,
        reload,
        retire,
        markLoaded,
        markReady,
    });
}
