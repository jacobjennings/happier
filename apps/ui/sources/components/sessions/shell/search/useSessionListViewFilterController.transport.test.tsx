import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompactSessionListRowFixture, createSessionListSourceFixture } from '@/dev/testkit/harness/sessionReadBatchHttpBoundary';
import { SessionListQueryResponseV1Schema } from '@happier-dev/protocol/sessions/listing/response';
import { normalizeSessionListFilterV1 } from '@happier-dev/protocol/sessions/listFilter/sessionListFilterV1';
import { buildBackendTargetKeyV2 } from '@happier-dev/protocol/backends/targets/backendTargetRefV2';
import { PluginAvailabilityActionHttpPathsV1, PluginAvailabilityMaterializationsReadActionOutputV1Schema,
    PluginAvailabilityIntentsListActionOutputV1Schema } from '@happier-dev/protocol/plugins/availability';

import { renderHook, renderScreen, flushHookEffects, standardCleanup } from '@/dev/testkit';
import { createSessionFixture, createPlainSessionCurrentProjectionRecordFixture, createSessionOwnerViewerFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createSessionListQuerySourceHarness, waitForSessionListQueryState } from '@/dev/testkit/harness/sessionListQuerySourceHarness';
import { storage } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { useSessionListQuerySourceState } from '@/sync/domains/session/listing/useSessionListQuerySourceState';
import { useVisibleSessionListSourceState } from '@/hooks/session/useVisibleSessionListSourceState';
import { useVisibleSessionListViewState } from '@/hooks/session/useVisibleSessionListViewState';
import { useSessionListViewFilterController } from './useSessionListViewFilterController';
import { clearSessionListViewFilterRetentionForTests } from './useSessionListViewFilters';
import { SessionListFilterEditor } from './SessionListFilterEditor';
import { buildSessionListFilterEditorLabels } from './SessionListFilterControl';
import { useSessionListFilterEditorOptions } from './useSessionListFilterEditorOptions';
import { useSessionListFilterLocalOptions } from './useSessionListFilterLocalOptions';
import { fetchSessionListQueryPageForHome } from '@/sync/domains/session/listing/sessionListQueryRuntime';
import { projectSessionDisplayV1, SessionDisplayProjectionV1Schema, SessionOwnerMetadataV1Schema,
    SessionSharedMetadataV1Schema, SessionCreationCorrespondenceV1Schema, deriveSessionCreationTagV1 } from '@happier-dev/protocol';
import { createSessionDisplayCrypto } from '@/sync/encryption/sessionDisplayCrypto';
import { resolveAgentExecutionTargetFromSessionMetadata } from '@happier-dev/agents';
import { matchSessionListRowLocalFilter } from '@/sync/domains/session/listing/sessionListWorkFilter';
import { buildSessionListCacheEntriesFromRenderables, buildSessionListRenderableFromCacheEntry } from '@/sync/domains/state/warmCacheAdapters';
import { SessionListCacheEntryV1Schema } from '@/sync/domains/state/warmCachePersistence';

// Native presentation and Socket.IO are external boundaries; Account, Settings,
// selection, query lifecycle, hydration and store owners below remain real.
vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('socket.io-client', async importOriginal =>
    (await import('@/dev/testkit/harness/serverAccountConnectionHarness')).createSocketIoClientBoundary(importOriginal));

afterEach(() => { standardCleanup(); clearSessionListViewFilterRetentionForTests(); });

describe('saved Session spaces through the mounted query transport', () => {
    it.each(['picker', 'local filter', 'inactive surface', 'persisted warm picker'] as const)('demands exact private configured targets from compact display through the %s rather than their shared presentation', async demandVia => {
        const boundary = await createSessionListQuerySourceHarness();
        const home = boundary.serverIds[0]!;
        try {
            boundary.http.answer(home, PluginAvailabilityActionHttpPathsV1['account.plugins.availability.materializations.read'], {
                body: PluginAvailabilityMaterializationsReadActionOutputV1Schema.parse({ availabilityCursor: 0, snapshots: [] }),
            });
            boundary.http.answer(home, PluginAvailabilityActionHttpPathsV1['account.plugins.availability.intents.list'], {
                body: PluginAvailabilityIntentsListActionOutputV1Schema.parse({ availabilityCursor: 0, pluginIds: [], intentReads: [], failedPluginIds: [] }),
            });
            await sync.awaitBootstrapForegroundAcquisition();
            await boundary.http.selectHomes([home]);
            const targets = ['private-review', 'private-build'].map(definitionId => ({ kind: 'agent' as const,
                identity: { pluginId: 'happier.agent.custom-acp', localId: 'custom-acp' }, definitionId }));
            const records = await Promise.all(targets.map(async (target, index) => {
                const id = `cold-configured-agent-${index}`;
                const correspondence = SessionCreationCorrespondenceV1Schema.parse({ v: 1,
                    sessionCreationTag: deriveSessionCreationTagV1({ callerCreationNamespace: 'cold-agent-test', creationKey: id }),
                    recipe: { execution: { machineId: 'm', directory: { kind: 'path', path: '/repo' } },
                        organization: { folderId: null, tagIds: [] }, agentTarget: target,
                        modelSelection: null, profileId: null, requestedPermissionMode: null, agentModeId: null,
                        configuration: null, connectedServices: null, capabilitySelection: null, transcriptStorage: null,
                        terminal: null, agentSessionStartupInstructionsMarkerV1: null, checkout: null },
                });
                const metadata = { name: id, path: '/repo', host: 'host', flavor: 'custom-acp',
                    agentPresentation: { agentId: 'custom-acp', label: 'Shared ACP presentation' },
                    sessionCreationCorrespondenceV1: correspondence };
                expect(resolveAgentExecutionTargetFromSessionMetadata(metadata)).toEqual(target);
                const full = createPlainSessionCurrentProjectionRecordFixture({ id, metadata });
                if (full.ownerMetadata?.t !== 'plain') throw new Error('Expected the canonical plaintext owner fixture');
                const display = projectSessionDisplayV1({ sharedMetadata: SessionSharedMetadataV1Schema.parse(JSON.parse(full.metadata!)),
                    ownerMetadata: SessionOwnerMetadataV1Schema.parse(full.ownerMetadata.v) });
                expect(display.shared.agentPresentation).toEqual(metadata.agentPresentation);
                const crypto = createSessionDisplayCrypto({ sessionMode: 'plain', accountMode: 'plain',
                    credentials: { token: 'plaintext-sealer', secret: '' } });
                const displayProjectionV1 = SessionDisplayProjectionV1Schema.parse({ v: 1,
                    sourceMetadataVersion: full.metadataVersion, metadataLayoutVersion: 1,
                    shared: await crypto.encodeSharedDisplay(display.shared), owner: crypto.encodeOwnerDisplay(display.owner!) });
                expect(JSON.stringify(displayProjectionV1)).not.toContain(target.definitionId);
                return { ...full, displayProjectionV1, viewer: createSessionOwnerViewerFixture(createSessionFixture({
                    id, ownerAccountId: boundary.accountId(home), metadata,
                })) };
            }));
            const page = createSessionListSourceFixture({ sessions: records, nextCursor: 'agent-next', hasNext: true,
                attentionNextCursor: null, attentionHasNext: false });
            SessionListQueryResponseV1Schema.parse({ ...page, sessions: records.map(createCompactSessionListRowFixture) });
            boundary.http.answer(home, '/v2/sessions/query', { body: page });
            for (const record of records) boundary.http.answer(home, `/v2/sessions/${record.id}`, { body: { session: record } });
            let baseline = boundary.http.requests.length;
            const fullReads = () => boundary.http.requests.slice(baseline).filter(request => request.path === '/v2/sessions/read-batch');
            const refreshDisplay = () => fetchSessionListQueryPageForHome(home, { source: { kind: 'query', allowV1Fallback: false,
                body: { v: 1, storage: 'active', includeInactive: true, scope: 'all_accessible', attention: 'any', audiences: [], tagIds: [], includeAttention: false } },
                membership: 'rowOnly', signal: new AbortController().signal });
            await refreshDisplay();
            const readRow = (index: number) => storage.getState().sessionListRowsByServerId[home]?.[records[index]!.id];
            expect(records.map((_, index) => readRow(index)?.metadata?.flavor)).toEqual(['custom-acp', 'custom-acp']);
            expect(fullReads()).toHaveLength(0);
            if (demandVia === 'persisted warm picker') {
                const homes = [{ serverId: home, label: 'Configured Home' }];
                const seed = await renderHook(() => useSessionListFilterLocalOptions(homes, 'agents', false));
                try {
                    await waitForSessionListQueryState(() => expect(seed.getCurrent().agents.map(option => option.agentTargetKey))
                        .toEqual(expect.arrayContaining(targets.map(buildBackendTargetKeyV2))));
                } finally { await seed.unmount(); }
                const entries = buildSessionListCacheEntriesFromRenderables(storage.getState().sessionListRowsByServerId[home] ?? {});
                const serialized = JSON.stringify(entries);
                for (const target of targets) expect(serialized).not.toContain(target.definitionId);
                expect(serialized).not.toContain('agentTargetKey');
                const restored = Object.values(JSON.parse(serialized) as Record<string, unknown>)
                    .map(entry => SessionListCacheEntryV1Schema.parse(entry));
                // The same cache-to-row/store boundary used by Sync's warm restore; no memory witnesses survive JSON.
                storage.getState().applyServerScopedSessionListRows(home, restored.map(buildSessionListRenderableFromCacheEntry),
                    { source: 'ordinary', mode: 'replace' });
                expect(records.map((_, index) => readRow(index)?.agentTargetKey)).toEqual([undefined, undefined]);
                baseline = boundary.http.requests.length;
                await refreshDisplay();
                expect(fullReads()).toHaveLength(0);
            }
            if (demandVia === 'inactive surface') {
                const keys = targets.map(buildBackendTargetKeyV2);
                const workFilter = normalizeSessionListFilterV1({ homeServerIds: [home],
                    startedBy: ['you', 'agents', 'triggers'], agents: { include: [keys[0]!], exclude: [] } });
                const homes = [{ serverId: home, queryMembership: 'rowOnly' as const, query: {
                    v: 1 as const, storage: 'active' as const, includeInactive: true, scope: 'all_accessible' as const,
                    attention: 'any' as const, audiences: [], tagIds: [], includeAttention: false,
                } }];
                let setActive: React.Dispatch<React.SetStateAction<boolean>> | undefined;
                const view = await renderHook(() => {
                    const [active, updateActive] = React.useState(false);
                    setActive = updateActive;
                    return useVisibleSessionListViewState('all', { queryHomes: homes, workFilter,
                        sessionListSurfaceDataActive: active });
                });
                try {
                    await waitForSessionListQueryState(() => expect(view.getCurrent().query?.statesByServerId[home]?.phase).toBe('ready'));
                    await flushHookEffects();
                    expect(fullReads()).toHaveLength(0);
                    expect(records.map((_, index) => readRow(index)?.agentTargetKey)).toEqual([undefined, undefined]);
                    await act(async () => setActive!(true));
                    await waitForSessionListQueryState(() => expect(readRow(0)?.agentTargetKey).toBe(keys[0]));
                    expect(readRow(1)?.agentTargetKey).toBe(keys[1]);
                    expect(fullReads()).toHaveLength(1);
                    expect(matchSessionListRowLocalFilter(readRow(0)!, home, workFilter, { nowMs: 1_000 })).toBe('match');
                    expect(matchSessionListRowLocalFilter(readRow(1)!, home, workFilter, { nowMs: 1_000 })).toBe('miss');
                    for (const record of records) expect(storage.getState().sessions[record.id]).toBeUndefined();
                } finally { await view.unmount(); }
                return;
            }
            let controller: ReturnType<typeof useSessionListViewFilterController> | undefined;
            let querySource: ReturnType<typeof useSessionListQuerySourceState> | undefined;
            function MountedPicker() {
                controller = useSessionListViewFilterController();
                const source = useVisibleSessionListSourceState({ queryHomes: controller.pagingHomes,
                    emptyQuerySelectionComplete: controller.emptyQuerySelectionComplete,
                    agentTargetDemand: Boolean(controller.filters.agents
                        && controller.filters.agents.include.length + controller.filters.agents.exclude.length > 0) });
                querySource = source.query;
                const homeIds = React.useMemo(() => controller!.homeOptions.map(option => option.serverId), [controller.homeOptions]);
                const options = useSessionListFilterEditorOptions(homeIds, controller.filters.homeServerIds);
                return <SessionListFilterEditor {...options} {...controller} homes={controller.homeOptions}
                    labels={buildSessionListFilterEditorLabels()} disableTransitions />;
            }
            const screen = await renderScreen(<MountedPicker />);
            try {
                await flushHookEffects();
                await waitForSessionListQueryState(() => expect(querySource?.statesByServerId[home]?.phase).toBe('ready'));
                expect(fullReads()).toHaveLength(0);
                const queryReadsBeforeDemand = boundary.http.requests.filter(request => request.path === '/v2/sessions/query').length;
                const targetKeys = targets.map(buildBackendTargetKeyV2);
                if (demandVia === 'picker' || demandVia === 'persisted warm picker') {
                    await screen.pressByTestIdAsync('collection-filter-add');
                    await screen.pressByTestIdAsync('collection-filter-field:agents');
                    for (const key of targetKeys) await vi.waitFor(() =>
                        expect(screen.findByTestId(`collection-filter-value:agents:${key}`)).not.toBeNull());
                    await screen.pressByTestIdAsync(`collection-filter-value:agents:${targetKeys[0]}`);
                } else {
                    // A local condition can be enabled after the compact corpus is already loaded.
                    await act(async () => controller!.updateFilters(previous => ({ ...previous,
                        agents: { include: [targetKeys[0]!], exclude: [] } })));
                    await vi.waitFor(() => expect(readRow(0)?.agentTargetKey).toBe(targetKeys[0]));
                    expect(readRow(1)?.agentTargetKey).toBe(targetKeys[1]);
                }
                expect(fullReads()).toHaveLength(1);
                expect(fullReads()[0]?.input).toMatchObject({ sessionIds: records.map(record => record.id),
                    includeSnapshot: true, includeTurns: false, includeMessages: false });
                expect(matchSessionListRowLocalFilter(readRow(0)!, home, controller!.filters, { nowMs: 1_000 })).toBe('match');
                expect(matchSessionListRowLocalFilter(readRow(1)!, home, controller!.filters, { nowMs: 1_000 })).toBe('miss');
                expect(boundary.http.requests.filter(request => request.path === '/v2/sessions/query')).toHaveLength(queryReadsBeforeDemand);
                expect(querySource?.statesByServerId[home]).toMatchObject({ nextCursor: 'agent-next', hasNext: true });
                for (const record of records) expect(storage.getState().sessions[record.id]).toBeUndefined();
            } finally { await screen.unmount(); }
        } finally { await boundary.dispose(); }
    });

});
