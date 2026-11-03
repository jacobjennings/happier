import type { ServerFetch } from '@/sync/http/client';
import type { ApiChangeEntry, ApiUpdateContainer } from '@/sync/api/types/apiTypes';
import { TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1 } from '@happier-dev/protocol/changes';
import { isRowLevelSessionChangeHint } from '@/sync/runtime/orchestration/changesPlanner';

type DiscoveryContext = Readonly<{
    request: ServerFetch;
    token: string;
    isCurrent(): boolean;
    migrate(sessionIds: readonly string[]): Promise<void>;
    log: { log(message: string): void };
}>;

export function changesRequireSessionMetadataUpgradeDiscovery(changes: readonly ApiChangeEntry[]): boolean {
    return changes.some(change => change.kind === 'share'
        || (change.kind === 'account' && change.entityId === TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1)
        // Older metadata/access producers have no discriminating hint. Keep
        // those conservative; known message/pending/read-cursor hints are local.
        || (change.kind === 'session' && (change.hint == null || !isRowLevelSessionChangeHint(change.hint))));
}

export function socketRequiresSessionMetadataUpgradeDiscovery(body: ApiUpdateContainer['body']): boolean {
    if (body.t === 'session-shared' || body.t === 'session-share-updated' || body.t === 'session-share-revoked'
        || body.t === 'public-share-created' || body.t === 'public-share-updated' || body.t === 'public-share-deleted') return true;
    if (body.t === 'new-session') return body.metadataLayoutVersion !== 1;
    return body.t === 'update-session' && body.metadataLayoutVersion !== 1
        && (body.metadata != null || body.ownerMetadata != null);
}

/** Account-scoped migration demand, independent of ordinary list invalidation. */
export class SessionMetadataUpgradeDiscovery {
    private pending = true;
    private inFlight: Promise<void> | null = null;
    private changedDuringFlight = false;

    invalidate(): void {
        this.pending = true;
        if (this.inFlight) this.changedDuringFlight = true;
    }

    requestRefresh(): void {
        if (!this.inFlight) this.pending = true;
    }

    refresh(context: DiscoveryContext, force = false): Promise<void> {
        // Explicit concurrent refreshes consume the same outstanding demand.
        // A real change calls invalidate(), retaining the next pass separately.
        if (force) this.requestRefresh();
        if (this.inFlight) return this.inFlight;
        if (!this.pending || !context.isCurrent()) return Promise.resolve();
        const run = async () => {
            do {
                this.pending = false;
                this.changedDuringFlight = false;
                await this.discoverAndMigrate(context);
                // Only a new authority signal admits another pass. Failure
                // alone remains pending for the existing next-sync recovery.
            } while (this.changedDuringFlight && context.isCurrent());
        };
        const attempt = run().finally(() => {
            if (this.inFlight === attempt) this.inFlight = null;
        });
        this.inFlight = attempt;
        return attempt;
    }

    private async discoverAndMigrate(context: DiscoveryContext): Promise<void> {
        try {
            const response = await context.request('/v2/sessions/metadata-upgrades', {
                method: 'GET', headers: { Authorization: `Bearer ${context.token}` },
            });
            if (!context.isCurrent()) { this.pending = true; return; }
            if (!response.ok) throw new Error('Session metadata upgrade discovery unavailable');
            const payload: unknown = await response.json();
            if (!context.isCurrent()) { this.pending = true; return; }
            if (!payload || typeof payload !== 'object' || !('sessionIds' in payload)
                || !Array.isArray(payload.sessionIds)
                || !payload.sessionIds.every((id): id is string => typeof id === 'string' && id.length > 0)) {
                throw new Error('Invalid Session metadata upgrade discovery');
            }
            // The full snapshot owner gathers this logical set once per real
            // transport chunk and applies the containing operation's work budget.
            await context.migrate([...new Set(payload.sessionIds)]);
        } catch {
            // The existing Session sync/recovery lifecycle owns the next attempt.
            this.pending = true;
            context.log.log('Shared Session metadata discovery deferred until the next sync');
        }
    }
}
