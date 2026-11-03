import { afterEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import type { ManagedConnectionTransport } from '@happier-dev/connection-supervisor';
import { SessionConsumptionReplaceV1Schema, type SessionConsumptionReplaceAckV1 } from '@happier-dev/protocol/sessions';
import { attachManagedSessionConsumptionSocket } from './attachManagedSessionConsumptionSocket';
// Fail collection loudly if the deferred runtime graph cannot load.
import './sessionLiveConsumption';
import { registerSessionRealtimeTranscriptConsumer, registerSessionTranscriptRetentionConsumer } from './sessionRealtimeTranscriptConsumers';
import { storage } from '@/sync/domains/state/storage';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

function socketBoundary() {
    const socket = io('http://session-consumption.test', { autoConnect: false });
    socket.connected = true;
    const statusListeners = {
        connected: new Set<Parameters<ManagedConnectionTransport['onConnected']>[0]>(),
        disconnected: new Set<Parameters<ManagedConnectionTransport['onDisconnected']>[0]>(),
    };
    const transport: Pick<ManagedConnectionTransport, 'isConnected' | 'onConnected' | 'onDisconnected'> = {
        isConnected: () => socket.connected,
        onConnected: listener => { statusListeners.connected.add(listener); return () => { statusListeners.connected.delete(listener); }; },
        onDisconnected: listener => { statusListeners.disconnected.add(listener); return () => { statusListeners.disconnected.delete(listener); }; },
    };
    const requests: unknown[] = [];
    let respond = async (payload: unknown): Promise<SessionConsumptionReplaceAckV1> => ({ ok: true, ...SessionConsumptionReplaceV1Schema.parse(payload) });
    vi.spyOn(socket, 'emitWithAck').mockImplementation(async (_event, payload) => { requests.push(payload); return respond(payload); });
    cleanup.push(() => { socket.connected = false; socket.disconnect(); vi.restoreAllMocks(); });
    return { socket, transport, requests,
        respond: (callback: typeof respond) => { respond = callback; },
        connected: (connected: boolean) => {
            socket.connected = connected;
            if (connected) for (const listener of statusListeners.connected) listener();
            else for (const listener of statusListeners.disconnected) listener({ intentional: false, reason: 'transport close' });
        },
    };
}

describe('managed Session consumption declaration', () => {
    it('uses the actual socket ACK boundary, isolates Homes, redeclares on reconnect and repairs only admitted live increases', async () => {
        const boundary = socketBoundary();
        const repairs: string[][] = [];
        cleanup.push(attachManagedSessionConsumptionSocket({ serverId: 'home-a', ...boundary,
            onLiveConsumptionAdmitted: ids => { repairs.push([...ids]); } }));
        await vi.waitFor(() => expect(boundary.requests).toEqual([{ v: 1, liveSessionIds: [], durableSessionIds: [] }]));
        cleanup.push(registerSessionTranscriptRetentionConsumer('retained', 'home-a'));
        cleanup.push(registerSessionRealtimeTranscriptConsumer('same-id', 'home-b'));
        const release = registerSessionRealtimeTranscriptConsumer('same-id', 'home-a');
        cleanup.push(release);
        await vi.waitFor(() => expect(repairs).toEqual([['same-id']]));
        expect(boundary.requests).toHaveLength(2);
        for (let index = 0; index < 100; index += 1) storage.setState({ sessionMessages: {} });
        expect(boundary.requests).toHaveLength(2);
        boundary.connected(false);
        boundary.connected(true);
        await vi.waitFor(() => expect(repairs).toEqual([['same-id'], ['same-id']]));
        release();
        await vi.waitFor(() => expect(boundary.requests.at(-1)).toEqual({ v: 1, liveSessionIds: [], durableSessionIds: [] }));
    });

    it('reports typed refusal without repair or retry and ignores an ACK from a disposed transport', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const boundary = socketBoundary();
        boundary.respond(async () => ({ ok: false, error: 'not_allowed' }));
        const repairs: string[][] = [];
        cleanup.push(registerSessionRealtimeTranscriptConsumer('session', 'home-a'));
        const detach = attachManagedSessionConsumptionSocket({ serverId: 'home-a', ...boundary,
            onLiveConsumptionAdmitted: ids => repairs.push([...ids]) });
        cleanup.push(detach);
        await vi.waitFor(() => expect(warning).toHaveBeenCalledWith('[session-consumption]', 'session_consumption_not_allowed'));
        expect(boundary.requests).toHaveLength(1);
        expect(repairs).toEqual([]);
        let acknowledge: (ack: SessionConsumptionReplaceAckV1) => void = () => {};
        boundary.respond(async () => await new Promise<SessionConsumptionReplaceAckV1>(resolve => { acknowledge = resolve; }));
        boundary.connected(false); boundary.connected(true);
        expect(boundary.requests).toHaveLength(2);
        detach();
        acknowledge({ ok: true, v: 1, liveSessionIds: ['session'], durableSessionIds: ['session'] });
        await Promise.resolve();
        expect(repairs).toEqual([]);
    });

    it('warns on partial admission while repairing admitted demand without a retry loop', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const boundary = socketBoundary();
        cleanup.push(registerSessionRealtimeTranscriptConsumer('allowed', 'home-a'));
        cleanup.push(registerSessionRealtimeTranscriptConsumer('refused', 'home-a'));
        boundary.respond(async () => ({ ok: true, v: 1, liveSessionIds: ['allowed'], durableSessionIds: ['allowed'] }));
        const repairs: string[][] = [];
        cleanup.push(attachManagedSessionConsumptionSocket({ serverId: 'home-a', ...boundary,
            onLiveConsumptionAdmitted: ids => repairs.push([...ids]) }));
        await vi.waitFor(() => expect(repairs).toEqual([['allowed']]));
        expect(warning).toHaveBeenCalledWith('[session-consumption]', 'session_consumption_partial_admission');
        expect(boundary.requests).toHaveLength(1);
        expect(boundary.transport.isConnected()).toBe(true);
    });
});
