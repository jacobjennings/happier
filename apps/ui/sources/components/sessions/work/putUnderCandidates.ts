import type { Session } from '@/sync/domains/state/storageTypes';
import { readSessionPresentationRecord, readSessionPresentationServerId, readSessionPresentationInputSource, type SessionRelationRecord, type SessionPresentationRecord } from '@/sync/domains/session/listing/sessionListRenderableSessionProjection';
import type { SessionManagerEligibilitySnapshot } from '@/sync/ops/relations/sessionManagerEligibility';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { readSessionFullPublicationUpdatedAt } from '@/sync/domains/session/sessionRuntimeObservation';

type SessionRecord = Readonly<Record<string, SessionRelationRecord>>;

export type PutUnderEligibility = Readonly<{ allowed: true; expectedManagerSessionId: string | null }> | Readonly<{
    allowed: false;
    reason: 'unavailable' | 'different_home' | 'archived' | 'input' | 'read' | 'pairwise' | 'cycle' | 'already_under';
}>;
export type PutUnderScope = Readonly<{ serverId?: string | null; accountId?: string; allowCurrentLead?: boolean }>;

/** Structural exclusions are local; endpoint/context admission comes only from the Home owner. */
export function resolvePutUnderEligibility(
    sessions: SessionRecord, sessionId: string, managerSessionId: string,
    facts?: SessionManagerEligibilitySnapshot | null, scope: PutUnderScope = {},
): PutUnderEligibility {
    const sessionInput = sessions[sessionId];
    const candidateInput = sessions[managerSessionId];
    if (!sessionInput || !candidateInput) return { allowed: false, reason: 'unavailable' };
    const session = readSessionPresentationRecord(sessionInput);
    const candidate = readSessionPresentationRecord(candidateInput);
    const serverId = readSessionPresentationServerId(sessionInput) ?? null;
    if (serverId === null) return { allowed: false, reason: 'unavailable' };
    if (!areServerProfileIdentifiersEquivalent(readSessionPresentationServerId(candidateInput) ?? null, serverId)
        || (scope.serverId !== undefined && !areServerProfileIdentifiersEquivalent(scope.serverId, serverId))) return { allowed: false, reason: 'different_home' };
    if (session.id === candidate.id) return { allowed: false, reason: 'cycle' };
    if (session.archivedAt != null || candidate.archivedAt != null) return { allowed: false, reason: 'archived' };
    if (session.access?.capabilities.readTranscript !== true || candidate.access?.capabilities.readTranscript !== true) return { allowed: false, reason: 'read' };
    if (session.access?.capabilities.submitAgentInput !== true || candidate.access?.capabilities.submitAgentInput !== true) return { allowed: false, reason: 'input' };
    // The current Home read owns cycle admission, the relation and the mutation's CAS basis.
    // Retained list rows may still show previous edges; they cannot decide the current graph.
    if (!facts || !facts.isCurrent() || !areServerProfileIdentifiersEquivalent(facts.serverId, serverId) || facts.sessionId !== session.id
        || (scope.accountId !== undefined && facts.accountId !== scope.accountId)) return { allowed: false, reason: 'unavailable' };
    if (!scope.allowCurrentLead && facts.currentManagerSessionId === candidate.id) return { allowed: false, reason: 'already_under' };
    const verdict = facts.readCandidate(candidate.id);
    return verdict ? verdict.allowed ? { allowed: true, expectedManagerSessionId: facts.currentManagerSessionId } : { allowed: false, reason: verdict.reason }
        : { allowed: false, reason: 'unavailable' };
}

/** Applicable targets include unavailable ones, so the chooser can explain current refusal. */
export function listPutUnderCandidateOptions(sessions: SessionRecord, session: Pick<Session, 'id' | 'serverId'>,
    facts?: SessionManagerEligibilitySnapshot | null) {
    return Object.values(sessions)
        .map((input) => ({ candidate: readSessionPresentationRecord(input), input, source: readSessionPresentationInputSource(input) }))
        // This chooser snapshots receipt recency on open, without promoting it to Session content time.
        .map(({ candidate, input, source }) => ({ candidate, input, updatedAt: readSessionFullPublicationUpdatedAt({
            id: candidate.id, serverId: readSessionPresentationServerId(input),
            updatedAt: source?.lifecycle.updatedAt ?? candidate.updatedAt,
        }), eligibility: resolvePutUnderEligibility(sessions, session.id, candidate.id, facts, {
            serverId: session.serverId ?? null, allowCurrentLead: true,
        }) }))
        .filter(({ eligibility }) => eligibility.allowed || !['cycle', 'archived', 'different_home'].includes(eligibility.reason))
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The Sessions offered by "Put under…", most recently active first. The current lead stays in the
 * list so the sheet can show where the Session sits now.
 */
export function listPutUnderCandidates(
    sessions: SessionRecord,
    session: Pick<Session, 'id' | 'serverId'>,
    facts?: SessionManagerEligibilitySnapshot | null,
): readonly SessionPresentationRecord[] {
    return listPutUnderCandidateOptions(sessions, session, facts)
        .filter(({ eligibility }) => eligibility.allowed).map(({ candidate }) => candidate);
}

/**
 * Whether dragging `sessionId` onto `managerSessionId` in the Sessions list is a real "put under": the
 * person can steer the dragged Session (the same right "Put under…" asks for), the target could
 * lead it, and it is not already its lead (that drop would change nothing, so it shows no target).
 */
export function canDropSessionUnder(sessions: SessionRecord, sessionId: string, managerSessionId: string,
    facts?: SessionManagerEligibilitySnapshot | null, scope?: PutUnderScope): boolean {
    return resolvePutUnderEligibility(sessions, sessionId, managerSessionId, facts, scope).allowed;
}
