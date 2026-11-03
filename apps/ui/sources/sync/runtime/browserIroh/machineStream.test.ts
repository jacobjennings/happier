/**
 * The browser `happier/machine/1` stream foundation (Lane 06 A7.4).
 *
 * Every boundary between a tab and the Rust endpoint must keep a machine stream
 * distinguishable from a Home-tunnel stream: the protocol is named by a closed
 * kind, routed to the exact wasm method, and never satisfied by the other
 * protocol's connection or handle.
 */
import { describe, expect, it } from 'vitest';

import { createBrowserIrohEndpointClient } from './endpointClient';
import { createBrowserMachineCarrierEndpointBinding } from './machineCarrierStream';
import { createBrowserIrohSharedEndpointOwner, type BrowserIrohEndpointHandle } from './sharedEndpointOwner';
import { createBrowserIrohWasmBinder } from './wasmBinder';
import { createBrowserIrohWorkerConnectionHandler, type BrowserIrohMessagePort } from './workerConnection';

const RELAY = 'https://relay.happier.test';
const TARGET = 'endpoint-machine-target';

/** Records every open the owner issues to the endpoint binding. */
function createRecordingBinding() {
    const opens: { endpointId: string; streamKind: string; relayUrls: readonly string[] }[] = [];
    const handle: BrowserIrohEndpointHandle = {
        endpointId: 'endpoint-local',
        appliedRelayUrls: () => [RELAY],
        applyRelayUrls: async () => {},
        openStream: async ({ endpointId, streamKind, relayUrls }) => {
            opens.push({ endpointId, streamKind, relayUrls });
            return {
                remoteEndpointId: endpointId,
                observedPath: 'relay',
                read: async () => ({ bytes: new Uint8Array([streamKind === 'machine' ? 1 : 0]), done: false }),
                write: async () => {},
                finishWrite: async () => {},
                cancel: () => {},
                close: async () => {},
            };
        },
        closeConnection: async () => {},
        close: async () => {},
    };
    return { handle, opens };
}

function createOwner() {
    const binding = createRecordingBinding();
    const owner = createBrowserIrohSharedEndpointOwner({
        randomBytes: (length) => new Uint8Array(length).fill(7),
        bindEndpoint: async () => binding.handle,
    });
    return { owner, binding };
}

/** A pair of ports wired to each other, as `SharedWorker` connects a tab. */
function createPortPair(): { tab: BrowserIrohMessagePort; worker: BrowserIrohMessagePort } {
    const listeners: { tab: ((event: { data: unknown }) => void)[]; worker: ((event: { data: unknown }) => void)[] } = {
        tab: [],
        worker: [],
    };
    return {
        tab: {
            postMessage: (message) => {
                for (const listener of [...listeners.worker]) listener({ data: message });
            },
            addEventListener: (_type, listener) => listeners.tab.push(listener),
        },
        worker: {
            postMessage: (message) => {
                for (const listener of [...listeners.tab]) listener({ data: message });
            },
            addEventListener: (_type, listener) => listeners.worker.push(listener),
        },
    };
}

describe('sync/runtime/browserIroh machine stream foundation', () => {
    it('routes a machine open to the exact wasm machine method and never to the Home method', async () => {
        const calls: string[] = [];
        class FakeProbe {
            static async create(): Promise<FakeProbe> {
                return new FakeProbe();
            }
            endpointId(): string { return 'endpoint-local'; }
            appliedRelayUrls(): string[] { return [RELAY]; }
            async applyRelayUrls(): Promise<void> {}
            async openIncrementalHomeTunnelStream(endpointId: string): Promise<number> {
                calls.push(`home:${endpointId}`);
                return 1;
            }
            async openIncrementalMachineStream(endpointId: string): Promise<number> {
                calls.push(`machine:${endpointId}`);
                return 2;
            }
            streamRemoteEndpointId(streamHandle: number): string { return `remote-${streamHandle}`; }
            streamObservedPath(): string { return 'relay'; }
            async readStream(): Promise<Uint8Array | null> { return null; }
            async writeStream(): Promise<void> {}
            async finishStreamWrite(): Promise<void> {}
            cancelStream(): void {}
            async closeStream(): Promise<void> {}
            closeHomeTunnelConnection(): void {}
            closeMachineConnection(): void {}
            async close(): Promise<void> {}
        }
        const binder = createBrowserIrohWasmBinder(async () => ({
            module: {
                default: async () => 'initialized',
                HappierBrowserIrohProbe: FakeProbe,
                HappierBrowserIrohOpenCancellation: class {
                    cancel(): void {}
                },
            },
            wasmUrl: 'wasm-url',
        }));
        const handle = await binder({ secretKey: new Uint8Array(32).fill(9), relayUrls: [RELAY] });

        const machine = await handle.openStream({ streamKind: 'machine', endpointId: TARGET, relayUrls: [RELAY] });
        const home = await handle.openStream({ streamKind: 'home', endpointId: TARGET, relayUrls: [RELAY] });

        expect(calls).toEqual([`machine:${TARGET}`, `home:${TARGET}`]);
        // Distinct wasm handles, so a machine stream can never be operated
        // through the Home stream's custody.
        expect(machine.remoteEndpointId).toBe('remote-2');
        expect(home.remoteEndpointId).toBe('remote-1');
        expect(machine.observedPath).toBe('relay');
    });

    it('keeps machine and Home opens to one target as separate owner streams', async () => {
        const { owner, binding } = createOwner();
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY] });

        const machine = await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'machine',
            endpointId: TARGET,
            relayUrls: [RELAY],
        });
        const home = await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'home',
            endpointId: TARGET,
            relayUrls: [RELAY],
        });

        expect(binding.opens.map((open) => open.streamKind)).toEqual(['machine', 'home']);
        expect(machine.streamId).not.toBe(home.streamId);
        expect(machine.observedPath).toBe('relay');
        // Each opaque stream id still operates its own wasm handle.
        await expect(owner.readStream({ clientId: 'tab-a', streamId: machine.streamId, maxBytes: 8 }))
            .resolves.toEqual({ bytes: new Uint8Array([1]), done: false });
        await expect(owner.readStream({ clientId: 'tab-a', streamId: home.streamId, maxBytes: 8 }))
            .resolves.toEqual({ bytes: new Uint8Array([0]), done: false });
    });

    it('exposes a machine-carrier opener bound to the exact target and this tab lease', async () => {
        const { owner, binding } = createOwner();
        const ports = createPortPair();
        createBrowserIrohWorkerConnectionHandler(owner, () => 'tab-a')(ports.worker);
        const client = createBrowserIrohEndpointClient(
            () => ({ port: ports.tab, onFailure: () => {} }),
            null,
        );

        const carrier = createBrowserMachineCarrierEndpointBinding(client);
        const endpointLease = await carrier.acquireEndpointLease([RELAY]);
        const duplex = await carrier.openMachineCarrierStream({
            alpn: 'happier/machine/1',
            endpointId: TARGET,
            relayUrls: [RELAY],
        });

        // The initiator identity is the one shared browser endpoint's.
        expect(endpointLease.endpointId).toBe('endpoint-local');
        expect(binding.opens).toEqual([{ endpointId: TARGET, streamKind: 'machine', relayUrls: [RELAY] }]);
        expect(duplex.remoteEndpointId).toBe(TARGET);
        // Relay-only: the carrier never claims a direct path.
        expect(duplex.observedPath).toBe('relay');
        await expect(duplex.read(8)).resolves.toEqual({ bytes: new Uint8Array([1]), done: false });
        await duplex.close();
        await endpointLease.release();
    });

    it('refuses to open a machine stream before this tab holds a lease', async () => {
        const { owner } = createOwner();
        const ports = createPortPair();
        createBrowserIrohWorkerConnectionHandler(owner, () => 'tab-a')(ports.worker);
        const client = createBrowserIrohEndpointClient(
            () => ({ port: ports.tab, onFailure: () => {} }),
            null,
        );

        const carrier = createBrowserMachineCarrierEndpointBinding(client);
        await expect(
            carrier.openMachineCarrierStream({ alpn: 'happier/machine/1', endpointId: TARGET, relayUrls: [RELAY] }),
        ).rejects.toThrow(/lease/iu);
    });

    it('refuses an aborted open and leaves no stream in custody', async () => {
        const { owner, binding } = createOwner();
        const ports = createPortPair();
        createBrowserIrohWorkerConnectionHandler(owner, () => 'tab-a')(ports.worker);
        const client = createBrowserIrohEndpointClient(
            () => ({ port: ports.tab, onFailure: () => {} }),
            null,
        );

        const carrier = createBrowserMachineCarrierEndpointBinding(client);
        await carrier.acquireEndpointLease([RELAY]);
        const controller = new AbortController();
        controller.abort();

        await expect(carrier.openMachineCarrierStream({
            alpn: 'happier/machine/1',
            endpointId: TARGET,
            relayUrls: [RELAY],
            signal: controller.signal,
        })).rejects.toThrow();
        // Nothing was dialed, so there is no orphaned stream for the transfer
        // owner to have to release.
        expect(binding.opens).toEqual([]);
        expect(owner.status().leaseCount).toBe(1);
    });
});
