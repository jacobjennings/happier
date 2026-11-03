import {
    buildRetryLaterProbeResultFromResponse,
    readRetryLaterHints,
    type ReadinessProbeResult,
} from '@happier-dev/connection-supervisor';

/** Domain denials and route failures do not establish Home-wide unavailability. */
export function classifyEndpointResponse(
    response: Readonly<{ status: number; headers: Headers }>,
    authenticated: boolean,
): Exclude<ReadinessProbeResult, Readonly<{ status: 'ready' }>> | null {
    if (authenticated && response.status === 401) {
        return { status: 'auth_failed', statusCode: 401, errorMessage: 'HTTP 401' };
    }
    if (response.status === 502 || response.status === 504) {
        return buildRetryLaterProbeResultFromResponse(response, `HTTP ${response.status}`);
    }
    if (response.status === 503) {
        const hints = readRetryLaterHints(response.headers);
        if (hints.retryAfterMs !== undefined || hints.reason === 'server_restarting') {
            return { status: 'retry_later', ...hints, errorMessage: 'HTTP 503' };
        }
    }
    return null;
}
