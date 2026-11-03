import * as React from 'react';
import { storage, useSessionListRowsByServerId } from '@/sync/domains/state/storage';
import { useServerCredentialAccountScopes } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { hydrateSessionListAgentTargetsForServerAccountScope } from '../fetchSessionMetadataInventoryForServerAccountScope';
import { fingerprintSessionListDisplayAdmission, hasCurrentSessionListDisplayMetadata, SESSION_LIST_DOCUMENT_ADMISSION } from '../sessionDocumentAdmission';
import { readSessionListRowsForServerId } from './sessionListRowStateLookup';

const NO_SERVERS: readonly string[] = Object.freeze([]);

/** An open Agent facet borrows the existing Account and full-snapshot lifetimes. */
export function useSessionListAgentTargetDemand(serverIds: readonly string[], enabled: boolean): void {
    const selectedIds = enabled ? serverIds : NO_SERVERS;
    const bindings = useServerCredentialAccountScopes(selectedIds);
    const selectDemand = React.useCallback((rows: ReturnType<typeof storage.getState>['sessionListRowsByServerId']) =>
        JSON.stringify(Object.entries(rows).flatMap(([serverId, bucket]) => Object.values(bucket).flatMap(row => {
            const admission = row[SESSION_LIST_DOCUMENT_ADMISSION];
            return admission && hasCurrentSessionListDisplayMetadata(row)
                ? [[serverId, row.id, row.metadataVersion, admission.observedMetadataVersion,
                    fingerprintSessionListDisplayAdmission(admission)]] : [];
        }))), []);
    // Target publication itself does not retrigger an unsuccessful borrower. New metadata/custody does.
    const demandIdentity = useSessionListRowsByServerId(selectedIds, selectDemand);
    React.useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        const retirements = [...bindings.values()].map(binding => binding.onRetire(() => controller.abort()));
        for (const binding of bindings.values()) {
            if (!binding.isCurrent()) continue;
            const rows = readSessionListRowsForServerId(storage.getState().sessionListRowsByServerId, binding.serverId);
            const sessionIds = Object.values(rows ?? {}).filter(row => row.agentTargetKey === undefined
                && hasCurrentSessionListDisplayMetadata(row)).map(row => row.id);
            if (sessionIds.length === 0) continue;
            void hydrateSessionListAgentTargetsForServerAccountScope({ scope: binding.scope, sessionIds,
                accountLifetime: binding, signal: controller.signal }).catch(() => {
                if (!controller.signal.aborted && binding.isCurrent()) console.warn('[session-list] Agent target details unavailable');
            });
        }
        return () => { controller.abort(); for (const retirement of retirements) retirement.dispose(); };
    }, [bindings, demandIdentity, enabled]);
}
