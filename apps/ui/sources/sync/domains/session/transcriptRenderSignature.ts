import type { Session } from '@/sync/domains/state/storageTypes';
import {
    buildSessionMetadataStabilitySignatureValue,
    buildStableJsonSignature,
} from '@/sync/domains/session/metadata/sessionMetadataStability';

const TRANSCRIPT_RENDER_IRRELEVANT_SESSION_KEYS = new Set<string>([
    'updatedAt',
    'activeAt',
    'thinkingAt',
    'latestTurnStatus',
    'latestTurnStatusObservedAt',
    'meaningfulActivityAt',
    'latestReadyEventAt',
    'latestUsage',
    'pendingVersion',
    'pendingCount',
    'pendingOwnerCount',
    'agentStateVersion',
    'pendingPermissionRequestCount',
    'pendingUserActionRequestCount',
    'lastRuntimeIssue',
]);

export function buildSessionTranscriptRenderSignature(session: Session): string {
    const signaturePayload: Record<string, unknown> = {};
    for (const key of Object.keys(session).sort()) {
        if (TRANSCRIPT_RENDER_IRRELEVANT_SESSION_KEYS.has(key)) continue;
        signaturePayload[key] = key === 'metadata'
            ? buildSessionMetadataStabilitySignatureValue(session.metadata ?? null)
            : session[key as keyof Session];
    }
    return buildStableJsonSignature(signaturePayload);
}
