import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '@/sync/domains/state/storageTypes';
import { resetSessionSurfaceVisibilityForTests } from '@/sync/domains/session/sessionSurfaceVisibility';
import { storage } from '@/sync/domains/state/storage';
import { useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { voiceSessionBindingStore } from '@/voice/binding/voiceConversationBindingStore';
import { setVoiceSessionSnapshot } from '@/voice/session/voiceSessionStore';
import {
    clearMountedSessionRealtimeScmConsumerScopes,
    registerSessionRealtimeScmConsumerScope,
} from '@/sync/runtime/sessionRealtimeScmConsumers';
import { resolveSessionLiveConsumption, resolveSessionScmMutationSignal } from './sessionLiveConsumption';
import { createSessionConsumptionProjection } from './sessionLiveConsumption';
import {
    clearMountedSessionRealtimeTranscriptConsumers,
    registerSessionRealtimeTranscriptConsumer,
    registerSessionTranscriptRetentionConsumer,
} from './sessionRealtimeTranscriptConsumers';
import { markSessionSurfaceVisible, markSessionSurfaceHidden } from '@/sync/domains/session/sessionSurfaceVisibility';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { createSessionFixture, createSessionAccessFixture } from '@/dev/testkit/fixtures/sessionFixtures';

const initialStorageState = storage.getInitialState();

function buildSession(params: Readonly<{ id: string; path: string; machineId: string }>): Session {
    return {
        id: params.id,
        seq: 1,
        createdAt: 1_000,
        updatedAt: 1_000,
        active: true,
        activeAt: 1_000,
        metadata: {
            path: params.path,
            machineId: params.machineId,
        } as Session['metadata'],
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        optimisticThinkingAt: null,
        encryptionMode: 'plain',
        latestTurnStatus: 'in_progress',
        latestTurnStatusObservedAt: 900,
    };
}

function registerRepoScmScope(): () => void {
    return registerSessionRealtimeScmConsumerScope({
        serverId: null,
        sessionId: 'scm-consumer',
        canonicalProjectKey: 'machine-a:/repo',
        machineScopeId: 'machine-a',
        repoRoot: '/repo',
    });
}

describe('resolveSessionScmMutationSignal', () => {
    beforeEach(() => {
        storage.setState(initialStorageState, true);
        useVoiceTargetStore.getState().setPrimaryActionSessionAddress(null);
        useVoiceTargetStore.getState().setVoiceLiveContextSessionAddresses([]);
        useVoiceTargetStore.getState().setLastFocusedSessionAddress(null);
        clearMountedSessionRealtimeScmConsumerScopes();
        clearMountedSessionRealtimeTranscriptConsumers();
        resetSessionSurfaceVisibilityForTests();
        voiceSessionBindingStore.setState(voiceSessionBindingStore.getInitialState(), true);
        setVoiceSessionSnapshot({ adapterId: null, sessionId: null, status: 'disconnected', mode: 'idle', canStop: false });
    });

    afterEach(() => {
        storage.setState(initialStorageState, true);
        useVoiceTargetStore.getState().setPrimaryActionSessionAddress(null);
        useVoiceTargetStore.getState().setVoiceLiveContextSessionAddresses([]);
        useVoiceTargetStore.getState().setLastFocusedSessionAddress(null);
        clearMountedSessionRealtimeScmConsumerScopes();
        clearMountedSessionRealtimeTranscriptConsumers();
        resetSessionSurfaceVisibilityForTests();
        voiceSessionBindingStore.setState(voiceSessionBindingStore.getInitialState(), true);
        setVoiceSessionSnapshot({ adapterId: null, sessionId: null, status: 'disconnected', mode: 'idle', canStop: false });
    });

    it('reports hidden same-project sessions without making them full content consumers', () => {
        storage.getState().applySessions([
            buildSession({ id: 'hidden-producer', machineId: 'machine-a', path: '/repo/packages/app' }),
            buildSession({ id: 'scm-consumer', machineId: 'machine-a', path: '/repo/packages/ui' }),
        ]);
        const unregister = registerRepoScmScope();

        try {
            expect(resolveSessionScmMutationSignal('hidden-producer')).toBe(true);
            expect(resolveSessionLiveConsumption('hidden-producer')).toEqual({
                isVisible: false,
                isFullContentConsumer: false,
            });
        } finally {
            unregister();
        }
    });

    it('publishes stable exact-Home declarations for actual consumers and ignores retention and unrelated ticks', () => {
        const declarations: unknown[] = [];
        const projection = createSessionConsumptionProjection('home-a');
        projection.subscribe(value => declarations.push(value));
        const baseline = projection.read();
        const retain = registerSessionTranscriptRetentionConsumer('retained', 'home-a');
        const otherHome = registerSessionRealtimeTranscriptConsumer('same-id', 'home-b');
        expect(projection.read()).toBe(baseline);
        const release = registerSessionRealtimeTranscriptConsumer('same-id', 'home-a');
        expect(declarations).toEqual([{ v: 1, liveSessionIds: ['same-id'], durableSessionIds: ['same-id'] }]);
        const live = projection.read();
        for (let index = 0; index < 100; index += 1) storage.setState({ sessionMessages: {} });
        expect(projection.read()).toBe(live);
        expect(declarations).toHaveLength(1);
        release();
        expect(declarations.at(-1)).toEqual({ v: 1, liveSessionIds: [], durableSessionIds: [] });
        projection.dispose(); retain(); otherHome();
    });

    it('notifies live surface, Voice and mounted SCM demand, including hidden same-project durable demand', () => {
        setVoiceSessionSnapshot({ adapterId: 'realtime', sessionId: 'control', status: 'connected', mode: 'idle', canStop: true });
        storage.getState().applySessions([
            { ...buildSession({ id: 'scm-consumer', machineId: 'machine-a', path: '/repo/ui' }), serverId: 'home-a' },
            { ...buildSession({ id: 'hidden-producer', machineId: 'machine-a', path: '/repo/app' }), serverId: 'home-a' },
        ]);
        const declarations: unknown[] = [];
        const projection = createSessionConsumptionProjection('home-a');
        projection.subscribe(value => declarations.push(value));
        const release = registerSessionRealtimeScmConsumerScope({ serverId: 'home-a', sessionId: 'scm-consumer',
            canonicalProjectKey: 'machine-a:/repo', machineScopeId: 'machine-a', repoRoot: '/repo' });
        expect(projection.read()).toEqual({ v: 1,
            liveSessionIds: ['scm-consumer'], durableSessionIds: ['hidden-producer', 'scm-consumer'] });
        useVoiceTargetStore.getState().setPrimaryActionSessionAddress({ serverId: 'home-a', sessionId: 'voice' });
        markSessionSurfaceVisible('surface', 'home-a');
        expect(projection.read().liveSessionIds).toEqual(['scm-consumer', 'surface', 'voice']);
        markSessionSurfaceHidden('surface', 'home-a');
        release();
        expect(projection.read()).toEqual({ v: 1, liveSessionIds: ['voice'], durableSessionIds: ['voice'] });
        expect(declarations).toHaveLength(5);
        projection.dispose();
    });

    it('tracks the bound Voice conversation and target on their exact Homes and releases them with the active attempt', () => {
        const conversation = createSessionConsumptionProjection('conversation-home');
        const target = createSessionConsumptionProjection('target-home');
        try {
            voiceSessionBindingStore.getState().bind({ adapterId: 'realtime', controlSessionId: 'control',
                conversationSessionId: 'conversation', conversationSessionAddress: { serverId: 'conversation-home', sessionId: 'conversation' },
                targetSessionAddress: { serverId: 'target-home', sessionId: 'target' }, transcriptMode: 'synthetic',
                lifetime: 'runtime_attempt', updatedAt: 1 });
            setVoiceSessionSnapshot({ adapterId: 'realtime', sessionId: 'control', status: 'connecting', mode: 'idle', canStop: true });
            expect(conversation.read().liveSessionIds).toEqual(['conversation']);
            expect(target.read().liveSessionIds).toEqual(['target']);
            setVoiceSessionSnapshot({ adapterId: null, sessionId: null, status: 'disconnected', mode: 'idle', canStop: false });
            expect(conversation.read().liveSessionIds).toEqual([]);
            expect(target.read().liveSessionIds).toEqual([]);
        } finally { conversation.dispose(); target.dispose(); }
    });

    it('uses admitted layout1 scoped display workspace facts across same-id Homes and reacts to row relocation', () => {
        const session = createSessionFixture({ id: 'same-id', serverId: 'home-a', metadataLayoutVersion: 1,
            // This admitted owner row gets workspace facts from the private owner projection,
            // independently of whether the shared carrier is readable.
            metadata: null, ownerMetadataView: { path: '/repo/app', host: 'host', machineId: 'machine-a' } });
        storage.getState().applySessions([createSessionFixture({ id: 'same-id', serverId: 'home-b',
            metadata: { path: '/other', host: 'host', machineId: 'machine-a' } })]);
        storage.getState().mergeSessionListRowsForServerScope('home-a', [buildSessionListRenderableFromSession(session)]);
        const projection = createSessionConsumptionProjection('home-a');
        const release = registerSessionRealtimeScmConsumerScope({ serverId: 'home-a', sessionId: 'consumer',
            canonicalProjectKey: 'machine-a:/repo', machineScopeId: 'machine-a', repoRoot: '/repo' });
        try {
            expect(projection.read().durableSessionIds).toEqual(['consumer', 'same-id']);
            expect(resolveSessionScmMutationSignal('same-id', 'home-a')).toBe(true);
            expect(resolveSessionScmMutationSignal('same-id', 'home-b')).toBe(false);
            const relocated = createSessionFixture({ ...session,
                ownerMetadataView: { path: '/outside', host: 'host', machineId: 'machine-a' }, metadataVersion: 2 });
            storage.getState().mergeSessionListRowsForServerScope('home-a', [buildSessionListRenderableFromSession(relocated)]);
            expect(projection.read().durableSessionIds).toEqual(['consumer']);
            const shared = createSessionFixture({ ...session, metadataVersion: 3, access: createSessionAccessFixture('view'), accessLevel: 'view' });
            storage.getState().mergeSessionListRowsForServerScope('home-a', [buildSessionListRenderableFromSession(shared)]);
            expect(projection.read().durableSessionIds).toEqual(['consumer']);
        } finally { release(); projection.dispose(); }
    });

    it('publishes zero declarations for scalar arrivals across a thousand-row Home while a real workspace move updates durable demand', () => {
        const producer = createSessionFixture({ id: 'producer', serverId: 'home-a',
            metadata: { path: '/repo/app', host: 'host', machineId: 'machine-a' } as Session['metadata'] });
        storage.getState().applySessions([producer, ...Array.from({ length: 1_000 }, (_, index) => createSessionFixture({
            id: `other-${index}`, serverId: 'home-a', metadata: { path: `/elsewhere/${index}`, host: 'host', machineId: 'machine-a' } as Session['metadata'],
        }))]);
        const projection = createSessionConsumptionProjection('home-a');
        const declarations: unknown[] = [];
        projection.subscribe(value => declarations.push(value));
        const release = registerSessionRealtimeScmConsumerScope({ serverId: 'home-a', sessionId: 'consumer',
            canonicalProjectKey: 'machine-a:/repo', machineScopeId: 'machine-a', repoRoot: '/repo' });
        try {
            const baseline = projection.read();
            for (let index = 0; index < 50; index += 1) {
                storage.getState().applySessions([{ ...producer, seq: index + 2, updatedAt: index + 2 }]);
            }
            expect(projection.read()).toBe(baseline);
            expect(declarations).toHaveLength(1);
            storage.getState().applySessions([{ ...producer, seq: 60, updatedAt: 60, metadataVersion: 2,
                metadata: { path: '/outside', host: 'host', machineId: 'machine-a' } as Session['metadata'] }]);
            expect(projection.read().durableSessionIds).toEqual(['consumer']);
            expect(declarations).toHaveLength(2);
        } finally { release(); projection.dispose(); }
    });

    it('keeps the mounted SCM consumer session itself a full content consumer', () => {
        storage.getState().applySessions([
            buildSession({ id: 'scm-consumer', machineId: 'machine-a', path: '/repo/packages/ui' }),
        ]);
        const unregister = registerRepoScmScope();

        try {
            expect(resolveSessionScmMutationSignal('scm-consumer')).toBe(true);
            expect(resolveSessionLiveConsumption('scm-consumer')).toEqual({
                isVisible: false,
                isFullContentConsumer: true,
            });
        } finally {
            unregister();
        }
    });

    it('reports false without mounted SCM consumer scopes', () => {
        storage.getState().applySessions([
            buildSession({ id: 'hidden-producer', machineId: 'machine-a', path: '/repo/packages/app' }),
        ]);
        expect(resolveSessionScmMutationSignal('hidden-producer')).toBe(false);
    });

    it('reports false for sessions outside the mounted project scope', () => {
        storage.getState().applySessions([
            buildSession({ id: 'other-repo-session', machineId: 'machine-a', path: '/elsewhere/app' }),
            buildSession({ id: 'scm-consumer', machineId: 'machine-a', path: '/repo/packages/ui' }),
        ]);
        const unregister = registerRepoScmScope();

        try {
            expect(resolveSessionScmMutationSignal('other-repo-session')).toBe(false);
        } finally {
            unregister();
        }
    });

    it('uses only attempt-local current targets as Voice transcript consumers', () => {
        setVoiceSessionSnapshot({ adapterId: 'realtime', sessionId: 'control', status: 'connected', mode: 'idle', canStop: true });
        useVoiceTargetStore.getState().setPrimaryActionSessionAddress({
            serverId: 'home-a',
            sessionId: 'same-session',
        });
        useVoiceTargetStore.getState().setVoiceLiveContextSessionAddresses([{
            serverId: 'home-b',
            sessionId: 'tracked-session',
        }]);
        useVoiceTargetStore.getState().setLastFocusedSessionAddress({
            serverId: 'home-b',
            sessionId: 'focused-session',
        });

        expect(resolveSessionLiveConsumption('same-session', 'home-a').isFullContentConsumer).toBe(true);
        expect(resolveSessionLiveConsumption('same-session', 'home-b').isFullContentConsumer).toBe(false);
        expect(resolveSessionLiveConsumption('tracked-session', 'home-b').isFullContentConsumer).toBe(false);
        expect(resolveSessionLiveConsumption('tracked-session', 'home-a').isFullContentConsumer).toBe(false);
        expect(resolveSessionLiveConsumption('focused-session', 'home-b').isFullContentConsumer).toBe(true);
        expect(resolveSessionLiveConsumption('focused-session', 'home-a').isFullContentConsumer).toBe(false);
    });

    it('releases a departed surface despite retained Voice targets, and consumes them only during active Voice', () => {
        const projection = createSessionConsumptionProjection('home-a');
        try {
            markSessionSurfaceVisible('focused', 'home-a');
            useVoiceTargetStore.getState().setLastFocusedSessionAddress({ serverId: 'home-a', sessionId: 'focused' });
            useVoiceTargetStore.getState().setPrimaryActionSessionAddress({ serverId: 'home-a', sessionId: 'primary' });
            markSessionSurfaceHidden('focused', 'home-a');
            expect(projection.read()).toEqual({ v: 1, liveSessionIds: [], durableSessionIds: [] });
            expect(resolveSessionLiveConsumption('focused', 'home-a').isFullContentConsumer).toBe(false);
            expect(resolveSessionLiveConsumption('primary', 'home-a').isFullContentConsumer).toBe(false);
            setVoiceSessionSnapshot({ adapterId: 'realtime', sessionId: 'control', status: 'connected', mode: 'idle', canStop: true });
            expect(projection.read().liveSessionIds).toEqual(['focused', 'primary']);
            setVoiceSessionSnapshot({ adapterId: null, sessionId: null, status: 'disconnected', mode: 'idle', canStop: false });
            expect(projection.read().liveSessionIds).toEqual([]);
        } finally { projection.dispose(); }
    });

    it('consumes a global Voice conversation on its exact Home without inventing a target or control session', () => {
        setVoiceSessionSnapshot({ adapterId: 'realtime', sessionId: 'global-control', status: 'connecting', mode: 'idle', canStop: true });
        voiceSessionBindingStore.getState().bind({
            adapterId: 'realtime', controlSessionId: 'global-control',
            conversationSessionId: 'conversation',
            conversationSessionAddress: { serverId: 'conversation-home', sessionId: 'conversation' },
            targetSessionAddress: null, transcriptMode: 'synthetic', lifetime: 'runtime_attempt', updatedAt: 1,
        });
        expect(resolveSessionLiveConsumption('conversation', 'conversation-home').isFullContentConsumer).toBe(true);
        expect(resolveSessionLiveConsumption('conversation', 'other-home').isFullContentConsumer).toBe(false);
        expect(resolveSessionLiveConsumption('global-control', 'conversation-home').isFullContentConsumer).toBe(false);

        voiceSessionBindingStore.getState().bind({
            adapterId: 'realtime', controlSessionId: 'global-control',
            conversationSessionId: 'conversation',
            conversationSessionAddress: { serverId: 'conversation-home', sessionId: 'conversation' },
            targetSessionAddress: { serverId: 'target-home', sessionId: 'target' },
            transcriptMode: 'synthetic', lifetime: 'runtime_attempt', updatedAt: 2,
        });
        expect(resolveSessionLiveConsumption('conversation', 'conversation-home').isFullContentConsumer).toBe(true);
        expect(resolveSessionLiveConsumption('conversation', 'target-home').isFullContentConsumer).toBe(false);
        expect(resolveSessionLiveConsumption('target', 'target-home').isFullContentConsumer).toBe(true);
        expect(resolveSessionLiveConsumption('target', 'conversation-home').isFullContentConsumer).toBe(false);
        expect(resolveSessionLiveConsumption('global-control', 'target-home').isFullContentConsumer).toBe(false);

        // Retained association is history, not a reason to keep hydrating either
        // transcript after this device's actual bound attempt has ended.
        setVoiceSessionSnapshot({ adapterId: 'realtime', sessionId: null, status: 'disconnected', mode: 'idle', canStop: false });
        expect(resolveSessionLiveConsumption('conversation', 'conversation-home').isFullContentConsumer).toBe(false);
        expect(resolveSessionLiveConsumption('target', 'target-home').isFullContentConsumer).toBe(false);
    });
});
