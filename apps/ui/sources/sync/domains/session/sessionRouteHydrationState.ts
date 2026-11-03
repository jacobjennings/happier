export type SessionRouteHydrationMissingCause =
    | 'not_found'
    | 'unauthorized'
    | 'forbidden'
    | 'auth_unavailable';

export type SessionRouteHydrationRetryCause =
    | 'network'
    | 'server_unavailable'
    | 'decrypting'
    | 'unknown';

export type SessionRouteHydrationState =
    | Readonly<{
        kind: 'loading';
        sessionId: string;
        serverId?: string;
        reason: 'cold' | 'server-switch' | 'store-miss' | 'refreshing';
    }>
    | Readonly<{
        kind: 'available';
        sessionId: string;
        serverId?: string;
    }>
    | Readonly<{
        kind: 'retrying';
        sessionId: string;
        serverId?: string;
        cause: SessionRouteHydrationRetryCause;
    }>
    | Readonly<{
        kind: 'missing';
        sessionId: string;
        serverId?: string;
        cause: SessionRouteHydrationMissingCause;
    }>;

export type EnsureSessionVisibleForRouteResult =
    | Readonly<{
        kind: 'available';
        sessionId: string;
        serverId?: string;
    }>
    | Readonly<{
        kind: 'missing';
        sessionId: string;
        serverId?: string;
        cause: SessionRouteHydrationMissingCause;
        errorCode?: string;
    }>
    | Readonly<{
        /** This observation was superseded; a new authority/publication or explicit retry must advance it. */
        kind: 'awaiting_push';
        sessionId: string;
        serverId?: string;
        errorCode: 'stale_response';
    }>
    | Readonly<{
        kind: 'retryable_failure';
        sessionId: string;
        serverId?: string;
        cause: SessionRouteHydrationRetryCause;
        errorCode?: string;
    }>;

export function createAvailableSessionRouteResult(sessionId: string, serverId?: string): Extract<EnsureSessionVisibleForRouteResult, { kind: 'available' }> {
    return { kind: 'available', sessionId, ...(serverId ? { serverId } : {}) };
}

export function createMissingSessionRouteResult(sessionId: string, serverId: string | undefined,
    cause: SessionRouteHydrationMissingCause): Extract<EnsureSessionVisibleForRouteResult, { kind: 'missing' }> {
    return { kind: 'missing', sessionId, ...(serverId ? { serverId } : {}), cause };
}

export function createRetryableSessionRouteResult(sessionId: string, serverId: string | undefined,
    cause: SessionRouteHydrationRetryCause): Extract<EnsureSessionVisibleForRouteResult, { kind: 'retryable_failure' }> {
    return { kind: 'retryable_failure', sessionId, ...(serverId ? { serverId } : {}), cause };
}

export function createAwaitingPushSessionRouteResult(sessionId: string, serverId?: string): Extract<EnsureSessionVisibleForRouteResult, { kind: 'awaiting_push' }> {
    return { kind: 'awaiting_push', sessionId, ...(serverId ? { serverId } : {}), errorCode: 'stale_response' };
}

export function readTerminalSessionRouteMissingCause(errorCode: string): SessionRouteHydrationMissingCause | null {
    return errorCode === 'not_found' || errorCode === 'unauthorized' || errorCode === 'forbidden' ? errorCode : null;
}

export function readRetryableSessionRouteCause(errorCode: string): SessionRouteHydrationRetryCause {
    if (errorCode === 'server_unavailable' || errorCode === 'network_error') return 'server_unavailable';
    return errorCode === 'session_encryption_not_found' ? 'decrypting' : 'unknown';
}

export function isSessionRouteHydrationAvailable(state: SessionRouteHydrationState): boolean {
    return state.kind === 'available';
}

export function isSessionRouteHydrationMissing(state: SessionRouteHydrationState): boolean {
    return state.kind === 'missing';
}

export function isSessionRouteHydrationPending(state: SessionRouteHydrationState): boolean {
    return state.kind === 'loading' || state.kind === 'retrying';
}
