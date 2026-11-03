import type { Session } from '@/sync/domains/state/storageTypes';
import { readSessionManagerSessionIdV1 } from '@happier-dev/protocol/sessions/follow/sessionManagerV1';
import { areServerProfileIdentifiersEquivalent, resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';

import { readSessionListRowsForServerId, type SessionListRowStateByServerId } from '@/sync/domains/session/listing/sessionListRowStateLookup';
import { readSessionPresentationRecord, readSessionPresentationInputRelations, type SessionRelationRecord } from '@/sync/domains/session/listing/sessionListRenderableSessionProjection';

const EMPTY_SESSIONS: readonly SessionRelationRecord[] = Object.freeze([]);

/** Relationship readers need the qualified list too: opening a transcript is not membership. */
export function selectSessionRelationRecords(
    sessions: Readonly<Record<string, Session>>,
    serverId: string | null,
    rowsByServerId?: SessionListRowStateByServerId,
): Readonly<Record<string, SessionRelationRecord>> {
    if (!serverId?.trim()) return {};
    const operationServerId = resolveServerProfileScopeIdForIdentifier(serverId);
    const records: Record<string, SessionRelationRecord> = {};
    for (const session of Object.values(sessions)) {
        if (session.serverId && areServerProfileIdentifiersEquivalent(session.serverId, serverId)) records[session.id] = session;
    }
    for (const row of Object.values(readSessionListRowsForServerId(rowsByServerId, operationServerId) ?? {})) {
        records[row.id] = { record: row, baseSession: sessions[row.id]?.serverId
            && areServerProfileIdentifiersEquivalent(sessions[row.id].serverId, operationServerId) ? sessions[row.id] : undefined, serverId: operationServerId };
    }
    return records;
}

function normalizeId(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

/**
 * The Sessions in this Session's `manager` subtree, as the store holds them.
 *
 * Inputs retain the admitted row and hydrated base independently. Mounted readers select their raw
 * references; an operation-local descriptor is never a second retained Session projection.
 */
export function selectSessionReportSubtree(
    sessions: Readonly<Record<string, Session>>,
    managerSessionId: string,
    serverId: string | null,
    rowsByServerId?: SessionListRowStateByServerId,
): readonly SessionRelationRecord[] {
    if (!serverId?.trim()) return EMPTY_SESSIONS;
    let childrenByLead: Map<string, SessionRelationRecord[]> | null = null;
    for (const session of Object.values(selectSessionRelationRecords(sessions, serverId, rowsByServerId))) {
        const lead = normalizeId(readSessionManagerSessionIdV1(readSessionPresentationInputRelations(session)));
        if (!lead) continue;
        childrenByLead ??= new Map();
        const siblings = childrenByLead.get(lead);
        if (siblings) siblings.push(session);
        else childrenByLead.set(lead, [session]);
    }
    if (!childrenByLead) return EMPTY_SESSIONS;
    const subtree: SessionRelationRecord[] = [];
    const visited = new Set<string>([managerSessionId]);
    const queue = [managerSessionId];
    while (queue.length > 0) {
        const lead = queue.shift() as string;
        for (const child of childrenByLead.get(lead) ?? []) {
            const record = readSessionPresentationRecord(child);
            if (visited.has(record.id)) continue;
            visited.add(record.id);
            subtree.push(child);
            queue.push(record.id);
        }
    }
    // Siblings read oldest first, the order the lead started them in.
    subtree.sort((a, b) => readSessionPresentationRecord(a).createdAt - readSessionPresentationRecord(b).createdAt);
    return subtree.length === 0 ? EMPTY_SESSIONS : subtree;
}
