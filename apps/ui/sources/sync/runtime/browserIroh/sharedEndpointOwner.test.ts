import { describe, expect, it, vi } from 'vitest';


import {
    createBrowserIrohSharedEndpointOwner,
    type BrowserIrohEndpointBinder,
    type BrowserIrohEndpointHandle,
} from './sharedEndpointOwner';

const RELAY_A = 'https://relay-a.happier.test';
const RELAY_B = 'https://relay-b.happier.test';

/**
 * Stands in for the wasm probe. Endpoint identity is derived from the seed the
 * owner supplies, which is exactly the property the singleton and continuity
 * rules depend on: a rotated key produces a different EndpointId, and a rebind
 * shows up as a second bind.
 */
/**
 * Relay sets this fake treats as invalid, so a test can script the core's
 * fail-closed validation of one contribution. The real grammar lives in
 * `happier-iroh-core`; here one marker entry stands in for it.
 */
const INVALID_RELAY = 'https://user:secret@relay.happier.invalid';

const unavailableTestStream: BrowserIrohEndpointHandle['openStream'] = async () => {
    throw new Error('stream boundary is not configured by this test');
};

function createRecordingBinder() {
    const binds: { secretKey: Uint8Array; relayUrls: readonly string[] }[] = [];
    const handles: (BrowserIrohEndpointHandle & { closed: () => boolean })[] = [];

    const bindEndpoint: BrowserIrohEndpointBinder = async ({ secretKey, relayUrls }) => {
        binds.push({ secretKey: new Uint8Array(secretKey), relayUrls: [...relayUrls] });
        // The core's `ensure_relay_urls` is a union: applying a contribution
        // never evicts what the endpoint already has. This fake mirrors that
        // one behavior so the owner is not tempted to union on its own side.
        let applied = [...relayUrls];
        let closed = false;
        const handle = {
            endpointId: `endpoint-${Array.from(secretKey.slice(0, 4)).join('-')}`,
            appliedRelayUrls: () => [...applied],
            applyRelayUrls: async (next: readonly string[]) => {
                // The core validates the whole contribution before applying
                // any of it; a malformed set fails without changing state.
                if (next.includes(INVALID_RELAY)) {
                    throw new Error('InvalidDescriptor');
                }
                for (const url of next) {
                    if (!applied.includes(url)) applied.push(url);
                }
            },
            openStream: unavailableTestStream,
            closeConnection: async () => {},
            close: async () => {
                closed = true;
            },
            closed: () => closed,
        };
        handles.push(handle);
        return handle;
    };

    return { bindEndpoint, binds, handles };
}

function createOwnerHarness(options?: { seedByte?: number }) {
    const binder = createRecordingBinder();
    let leaseCounter = 0;
    const seeds: Uint8Array[] = [];
    const owner = createBrowserIrohSharedEndpointOwner({
        randomBytes: (length) => {
            const seed = new Uint8Array(length).fill(options?.seedByte ?? 7);
            seeds.push(seed);
            return seed;
        },
        bindEndpoint: binder.bindEndpoint,
        newLeaseId: () => `lease-${(leaseCounter += 1)}`,
    });
    return { owner, binder, seeds };
}

describe('sync/runtime/browserIroh/sharedEndpointOwner', () => {
    it('keeps stream custody with the owning client and bounds incremental I/O', async () => {
        const calls: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async (maxBytes) => {
                        calls.push(`read:${maxBytes}`);
                        return { bytes: new Uint8Array([1, 2]), done: false };
                    },
                    write: async (bytes) => {
                        calls.push(`write:${bytes.byteLength}`);
                    },
                    finishWrite: async () => {
                        calls.push('finish');
                    },
                    cancel: () => {
                        calls.push('cancel');
                    },
                    close: async () => {
                        calls.push('close');
                    },
                }),
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const stream = await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'home',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });

        expect(stream).toEqual({
            streamId: 'stream-1',
            remoteEndpointId: 'endpoint-remote',
            observedPath: 'relay',
        });
        await expect(owner.readStream({ clientId: 'tab-b', streamId: stream.streamId, maxBytes: 16 }))
            .rejects.toMatchObject({ code: 'unknown_stream' });
        await expect(owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 0 }))
            .rejects.toMatchObject({ code: 'resource_limit' });
        await expect(owner.writeStream({
            clientId: 'tab-a',
            streamId: stream.streamId,
            bytes: new Uint8Array(1024 * 1024 + 1),
        })).rejects.toMatchObject({ code: 'resource_limit' });

        await expect(owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 16 }))
            .resolves.toEqual({ bytes: new Uint8Array([1, 2]), done: false });
        await owner.writeStream({ clientId: 'tab-a', streamId: stream.streamId, bytes: new Uint8Array([7]) });
        await owner.finishStreamWrite({ clientId: 'tab-a', streamId: stream.streamId });
        expect(calls).toEqual(['read:16', 'write:1', 'finish']);
    });

    it('cancels owned streams on lease release, with idempotent close', async () => {
        let cancels = 0;
        let closes = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => await new Promise<never>(() => {}),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => { cancels += 1; },
                    close: async () => { closes += 1; },
                }),
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const stream = await owner.openStream({
            clientId: 'tab-a', leaseId: lease.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        const heldRead = owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 16 });

        await leaseRelease(owner, lease.leaseId);
        await expect(heldRead).rejects.toMatchObject({ code: 'cancelled' });
        await expect(owner.closeStream({ clientId: 'tab-a', streamId: stream.streamId })).resolves.toBeUndefined();
        await expect(owner.closeStream({ clientId: 'tab-a', streamId: stream.streamId })).resolves.toBeUndefined();
        expect(cancels).toBe(1);
        expect(closes).toBe(1);

        async function leaseRelease(
            target: ReturnType<typeof createBrowserIrohSharedEndpointOwner>,
            leaseId: string,
        ): Promise<void> {
            await target.releaseLease({ clientId: 'tab-a', leaseId });
        }
    });

    it('retains a late-opened stream whose close fails and retries it on the next lease release', async () => {
        let releaseOpen: (() => void) | null = null;
        const openGate = new Promise<void>((resolve) => {
            releaseOpen = resolve;
        });
        let openStarted = false;
        let cancels = 0;
        let closeAttempts = 0;
        let connectionCloses = 0;
        let connectionLive = false;
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => {
                    openStarted = true;
                    await openGate;
                    connectionLive = true;
                    return {
                        remoteEndpointId: endpointId,
                        observedPath: 'relay',
                        read: async () => ({ bytes: new Uint8Array(), done: true }),
                        write: async () => {},
                        finishWrite: async () => {},
                        cancel: () => { cancels += 1; },
                        close: async () => {
                            closeAttempts += 1;
                            if (closeAttempts === 1) throw new Error('stream close exploded');
                        },
                    };
                },
                closeConnection: async () => {
                    if (!connectionLive) return;
                    connectionLive = false;
                    connectionCloses += 1;
                },
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-late',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const opening = owner.openStream({
            clientId: 'tab-a', leaseId: lease.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        await vi.waitFor(() => expect(openStarted).toBe(true));

        await owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId });
        releaseOpen!();

        await expect(opening).rejects.toThrow('stream close exploded');
        expect(cancels).toBe(1);
        expect(closeAttempts).toBe(1);
        expect(connectionCloses).toBe(0);

        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId }))
            .resolves.toBeUndefined();
        expect(cancels).toBe(1);
        expect(closeAttempts).toBe(2);
        expect(connectionCloses).toBe(1);
    });

    it('closes a target connection after its final owning lease and redials on later use', async () => {
        let leaseCounter = 0;
        let streamCounter = 0;
        let dials = 0;
        let connectionLive = false;
        const connectionCloses: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ streamKind, endpointId }) => {
                    if (!connectionLive) {
                        connectionLive = true;
                        dials += 1;
                    }
                    return {
                        remoteEndpointId: endpointId,
                        observedPath: 'relay',
                        read: async () => ({ bytes: new Uint8Array(), done: true }),
                        write: async () => {},
                        finishWrite: async () => {},
                        cancel: () => {},
                        close: async () => {},
                    };
                },
                closeConnection: async ({ streamKind, endpointId }) => {
                    connectionCloses.push(`${streamKind}:${endpointId}`);
                    connectionLive = false;
                },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
            newStreamId: () => `stream-${(streamCounter += 1)}`,
        });
        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const sibling = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });
        for (const [clientId, leaseId] of [['tab-a', first.leaseId], ['tab-b', sibling.leaseId]] as const) {
            await owner.openStream({
                clientId,
                leaseId,
                streamKind: 'home',
                endpointId: 'endpoint-remote',
                relayUrls: [RELAY_A],
            });
        }

        await owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId });
        expect(connectionCloses).toEqual([]);
        expect(dials).toBe(1);

        await owner.releaseLease({ clientId: 'tab-b', leaseId: sibling.leaseId });
        expect(connectionCloses).toEqual(['home:endpoint-remote']);

        const later = await owner.acquireLease({ clientId: 'tab-c', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-c',
            leaseId: later.leaseId,
            streamKind: 'home',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });
        expect(dials).toBe(2);
    });

    it('closes the connection when its final sibling leases release concurrently', async () => {
        let leaseCounter = 0;
        let streamCounter = 0;
        let connectionCloses = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => {},
                    close: async () => {},
                }),
                closeConnection: async () => { connectionCloses += 1; },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
            newStreamId: () => `stream-${(streamCounter += 1)}`,
        });
        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const second = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a', leaseId: first.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        await owner.openStream({
            clientId: 'tab-b', leaseId: second.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });

        await Promise.all([
            owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId }),
            owner.releaseLease({ clientId: 'tab-b', leaseId: second.leaseId }),
        ]);

        expect(connectionCloses).toBe(1);
        expect(owner.status().leaseCount).toBe(0);
    });

    it('retains final-lease connection cleanup custody until close succeeds', async () => {
        let closeAttempts = 0;
        const closedConnections: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => {},
                    close: async () => {},
                }),
                closeConnection: async ({ streamKind, endpointId }) => {
                    closeAttempts += 1;
                    closedConnections.push(`${streamKind}:${endpointId}`);
                    if (closeAttempts === 1) throw new Error('connection close exploded');
                },
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'machine',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });

        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId }))
            .rejects.toThrow('connection close exploded');
        expect(owner.status().leaseCount).toBe(1);

        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId }))
            .resolves.toBeUndefined();
        expect(closeAttempts).toBe(2);
        expect(closedConnections).toEqual([
            'machine:endpoint-remote',
            'machine:endpoint-remote',
        ]);
        expect(owner.status().leaseCount).toBe(0);
    });

    it('retries failed requested Machine custody before a later Machine acquisition without releasing live Home custody', async () => {
        let leaseCounter = 0;
        let streamCounter = 0;
        let failedMachineClose = true;
        const connectionCloseAttempts: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => {},
                    close: async () => {},
                }),
                closeConnection: async ({ streamKind, endpointId }) => {
                    connectionCloseAttempts.push(`${streamKind}:${endpointId}`);
                    if (streamKind === 'machine' && failedMachineClose) {
                        failedMachineClose = false;
                        throw new Error('machine connection close failed');
                    }
                },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
            newStreamId: () => `stream-${(streamCounter += 1)}`,
        });
        const homeLease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a', leaseId: homeLease.leaseId, streamKind: 'home', endpointId: 'home-remote', relayUrls: [RELAY_A],
        });
        const failedLease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a', leaseId: failedLease.leaseId, streamKind: 'machine', endpointId: 'machine-old', relayUrls: [RELAY_A],
        });
        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: failedLease.leaseId }))
            .rejects.toThrow('machine connection close failed');

        const laterLease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a', leaseId: laterLease.leaseId, streamKind: 'machine', endpointId: 'machine-new', relayUrls: [RELAY_A],
        });

        expect(connectionCloseAttempts).toEqual([
            'machine:machine-old',
            'machine:machine-old',
        ]);
        expect(owner.status()).toMatchObject({ leaseCount: 2 });
        await expect(owner.readStream({ clientId: 'tab-a', streamId: 'stream-1', maxBytes: 1 }))
            .resolves.toEqual({ bytes: new Uint8Array(), done: true });
    });

    it('retries a failed requested stream close on later Machine acquisition without releasing its live lease', async () => {
        let leaseCounter = 0;
        let streamCounter = 0;
        let closeAttempts = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => {},
                    close: async () => {
                        closeAttempts += 1;
                        if (closeAttempts === 1) throw new Error('stream close failed');
                    },
                }),
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
            newStreamId: () => `stream-${(streamCounter += 1)}`,
        });
        const firstLease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const firstStream = await owner.openStream({
            clientId: 'tab-a', leaseId: firstLease.leaseId, streamKind: 'machine', endpointId: 'machine-old', relayUrls: [RELAY_A],
        });
        await expect(owner.closeStream({ clientId: 'tab-a', streamId: firstStream.streamId }))
            .rejects.toThrow('stream close failed');

        const laterLease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a', leaseId: laterLease.leaseId, streamKind: 'machine', endpointId: 'machine-new', relayUrls: [RELAY_A],
        });

        expect(closeAttempts).toBe(2);
        expect(owner.status()).toMatchObject({ leaseCount: 2 });
        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: firstLease.leaseId }))
            .resolves.toBeUndefined();
    });

    it('retries prior failed requested custody when the page releases its client without touching a sibling client', async () => {
        let leaseCounter = 0;
        let closeAttempts = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: unavailableTestStream,
                closeConnection: async ({ endpointId }) => {
                    if (endpointId === 'machine-old') {
                        closeAttempts += 1;
                        if (closeAttempts === 1) throw new Error('machine connection close failed');
                    }
                },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
        });
        const failedLease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const siblingLease = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });
        await expect(owner.openStream({
            clientId: 'tab-a', leaseId: failedLease.leaseId, streamKind: 'machine', endpointId: 'machine-old', relayUrls: [RELAY_A],
        })).rejects.toThrow('stream boundary is not configured');
        await expect(owner.openStream({
            clientId: 'tab-b', leaseId: siblingLease.leaseId, streamKind: 'home', endpointId: 'home-sibling', relayUrls: [RELAY_A],
        })).rejects.toThrow('stream boundary is not configured');
        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: failedLease.leaseId }))
            .rejects.toThrow('machine connection close failed');

        await expect(owner.releaseClient('tab-a')).resolves.toBeUndefined();

        expect(closeAttempts).toBe(2);
        expect(owner.status()).toMatchObject({ leaseCount: 1 });
        await expect(owner.releaseLease({ clientId: 'tab-b', leaseId: siblingLease.leaseId }))
            .resolves.toBeUndefined();
    });

    it('keeps the sibling client live when one client releases', async () => {
        const { owner, binder } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        await owner.releaseClient('tab-a');

        expect(binder.handles[0]!.closed()).toBe(false);
        expect(owner.status()).toMatchObject({
            state: 'ready',
            endpointId: first.endpointId,
            leaseCount: 1,
        });
    });

    it('fences a release against an in-flight first acquire without tombstoning the client', async () => {
        const binder = createRecordingBinder();
        let finishBinding: (() => void) | null = null;
        const bindingGate = new Promise<void>((resolve) => {
            finishBinding = resolve;
        });
        let bindingStarted = false;
        let leaseCounter = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async (input) => {
                bindingStarted = true;
                await bindingGate;
                return await binder.bindEndpoint(input);
            },
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
        });

        const departedAcquire = owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const siblingAcquire = owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });
        await vi.waitFor(() => expect(bindingStarted).toBe(true));

        await owner.releaseClient('tab-a');
        finishBinding!();

        await expect(departedAcquire).rejects.toMatchObject({ code: 'cancelled' });
        const sibling = await siblingAcquire;
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 1 });

        const later = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        expect(later.leaseId).not.toBe(sibling.leaseId);
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 2 });

        await owner.releaseClient('tab-a');
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 1 });
    });

    it('keeps the endpoint after the last client releases, as a logout would', async () => {
        const { owner, binder } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId });

        expect(binder.handles[0]!.closed()).toBe(false);
        expect(owner.status()).toMatchObject({
            state: 'ready',
            endpointId: first.endpointId,
            leaseCount: 0,
        });
    });

    it('adopts a second Home relay set without rotating the seed or replacing the endpoint', async () => {
        const { owner, binder } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const second = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_B] });

        expect(binder.binds).toHaveLength(1);
        expect(second.endpointId).toBe(first.endpointId);
        expect(first.leaseId).not.toBe(second.leaseId);
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 2 });
        // A union: adopting a second Home never evicts the first Home's relay.
        expect(second.appliedRelayUrls).toEqual([RELAY_A, RELAY_B]);
    });

    it('mints one ephemeral identity per owner, so a replacement worker is a new endpoint', async () => {
        // Lane 06 amendment A10: the identity lives in the live SharedWorker
        // global and nowhere else. A replacement worker global builds a new
        // owner, which must mint its own seed rather than reading one back from
        // any device-local store — there is no store to read.
        const first = createOwnerHarness({ seedByte: 7 });
        const replacement = createOwnerHarness({ seedByte: 99 });

        const before = await first.owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const after = await replacement.owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        expect(after.endpointId).not.toBe(before.endpointId);
        expect(replacement.binder.binds[0]!.secretKey).not.toEqual(first.binder.binds[0]!.secretKey);
    });

    it('keeps one identity for the whole life of the owner, across leases and releases', async () => {
        const { owner, binder } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId });
        const later = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        expect(later.endpointId).toBe(first.endpointId);
        // One seed, one bind: an owner that re-minted per lease would rotate
        // the EndpointId every Machine grant binds.
        expect(binder.binds).toHaveLength(1);
    });

    it('wipes the seed buffer it created once the endpoint has copied it', async () => {
        // Bounded best-effort memory hygiene: the buffer this owner allocated
        // must not stay readable in the worker heap after the endpoint holds
        // its own copy. It is not a claim about the browser VM's copies.
        const { owner, binder, seeds } = createOwnerHarness();

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        expect(seeds).toHaveLength(1);
        expect([...seeds[0]!]).toEqual(new Array(seeds[0]!.length).fill(0));
        // The endpoint still bound the real bytes; only this owner's buffer went.
        expect(binder.binds[0]!.secretKey.some((byte) => byte !== 0)).toBe(true);
    });

    it('fails closed when a relay-only acquire supplies no relay', async () => {
        const { owner, binder } = createOwnerHarness();

        await expect(
            owner.acquireLease({ clientId: 'tab-a', relayUrls: [] }),
        ).rejects.toMatchObject({ code: 'relay_required' });
        expect(binder.binds).toHaveLength(0);
    });

    it('does not let an invalid relay contribution poison a later valid acquisition', async () => {
        // Relay grammar and validation are the core's, reached through the bound
        // endpoint. The owner must contribute each caller's relay facts as they
        // arrive and retain none of them itself: an entry the core rejected must
        // not be re-sent by the next, valid acquisition.
        const { owner, binder } = createOwnerHarness();

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        await expect(
            owner.acquireLease({ clientId: 'tab-b', relayUrls: [INVALID_RELAY] }),
        ).rejects.toThrow(/InvalidDescriptor/u);
        // The rejected contribution cost no endpoint state and no lease.
        expect(binder.handles[0]!.closed()).toBe(false);
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 1 });

        const valid = await owner.acquireLease({ clientId: 'tab-c', relayUrls: [RELAY_B] });
        // Monotonic valid growth, as the core defines it: A was never evicted by
        // the rejected B, and the later valid contribution joined the set.
        expect(valid.appliedRelayUrls).toEqual([RELAY_A, RELAY_B]);
        expect(binder.binds).toHaveLength(1);
    });

    it('reaches the endpoint with a contribution made while the first bind was in flight', async () => {
        const { owner, binder } = createOwnerHarness();

        const [first, second] = await Promise.all([
            owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] }),
            owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_B] }),
        ]);

        expect(binder.binds).toHaveLength(1);
        expect(second.endpointId).toBe(first.endpointId);
        // Both contributions reached the one endpoint; which one is observed
        // first depends on apply order, but the union is deterministic.
        expect([...first.appliedRelayUrls].sort()).toEqual([RELAY_A, RELAY_B].sort());
        expect([...second.appliedRelayUrls].sort()).toEqual([RELAY_A, RELAY_B].sort());
    });

    it('refuses to let one client release a sibling client’s lease', async () => {
        // A lease id is not a capability another port may spend. Ports are
        // reachable by any script on the origin, and a guessed or observed id
        // must not let one tab drop the lease another tab is relying on.
        const { owner, binder } = createOwnerHarness();
        const held = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        await expect(
            owner.releaseLease({ clientId: 'tab-b', leaseId: held.leaseId }),
        ).rejects.toMatchObject({ code: 'unknown_lease' });

        // The refusal cost the owner nothing: the lease is still held and the
        // endpoint was never touched.
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 2 });
        expect(binder.handles[0]!.closed()).toBe(false);
        await owner.releaseLease({ clientId: 'tab-a', leaseId: held.leaseId });
        expect(owner.status()).toMatchObject({ leaseCount: 1 });
    });

    it('treats releasing an absent lease as the success the caller asked for', async () => {
        // A reload, a repeated release, and a release after `releaseClient`
        // all arrive at the same place: this client holds no such lease. That
        // is the requested outcome, not a failure to report.
        const { owner, binder } = createOwnerHarness();
        const held = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        await expect(
            owner.releaseLease({ clientId: 'tab-a', leaseId: 'lease-does-not-exist' }),
        ).resolves.toBeUndefined();

        await owner.releaseLease({ clientId: 'tab-a', leaseId: held.leaseId });
        // Repeating the exact same release is idempotent.
        await expect(
            owner.releaseLease({ clientId: 'tab-a', leaseId: held.leaseId }),
        ).resolves.toBeUndefined();
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 0 });
        expect(binder.handles[0]!.closed()).toBe(false);
    });

    it('is idempotent in both release orderings for one client', async () => {
        const { owner } = createOwnerHarness();
        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        // release → releaseAll: the lease is already gone when the sweep runs.
        await owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId });
        await owner.releaseClient('tab-a');
        expect(owner.status()).toMatchObject({ leaseCount: 1 });

        // releaseAll → release: the sweep already took the lease this release
        // names, and naming it again still succeeds.
        const second = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.releaseClient('tab-a');
        await expect(
            owner.releaseLease({ clientId: 'tab-a', leaseId: second.leaseId }),
        ).resolves.toBeUndefined();
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 1 });
    });

    it('attempts every dead-client lease when one sibling release fails', async () => {
        const connectionReleaseAttempts: string[] = [];
        let leaseCounter = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: unavailableTestStream,
                closeConnection: async ({ endpointId }) => {
                    connectionReleaseAttempts.push(endpointId);
                    if (endpointId === 'endpoint-failing') throw new Error('release failed');
                },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
        });
        const failing = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const sibling = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await expect(owner.openStream({
            clientId: 'tab-a', leaseId: failing.leaseId, streamKind: 'home', endpointId: 'endpoint-failing', relayUrls: [RELAY_A],
        })).rejects.toThrow('stream boundary is not configured');
        await expect(owner.openStream({
            clientId: 'tab-a', leaseId: sibling.leaseId, streamKind: 'home', endpointId: 'endpoint-sibling', relayUrls: [RELAY_A],
        })).rejects.toThrow('stream boundary is not configured');

        await expect(owner.releaseClient('tab-a')).rejects.toThrow('release failed');

        expect(connectionReleaseAttempts).toEqual(['endpoint-failing', 'endpoint-sibling']);
        expect(owner.status()).toMatchObject({ leaseCount: 1 });
    });

    it('rejects a cancelled stream before it reaches WASM read, write, or half-close', async () => {
        // Lane 06 amendment A10. Cancelling a browser stream tears down the
        // Rust/WASM side; invoking `read`/`write`/`finishWrite` on it afterwards
        // is a use-after-cancel at the boundary, not a merely redundant call.
        // The owner must refuse without touching the handle at all.
        const invocations: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => {
                        invocations.push('read');
                        return { bytes: new Uint8Array(), done: true };
                    },
                    write: async () => {
                        invocations.push('write');
                    },
                    finishWrite: async () => {
                        invocations.push('finishWrite');
                    },
                    cancel: () => {
                        invocations.push('cancel');
                    },
                    close: async () => {
                        invocations.push('close');
                    },
                }),
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const stream = await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'machine',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });

        await owner.cancelStream({ clientId: 'tab-a', streamId: stream.streamId });
        expect(invocations).toEqual(['cancel']);

        await expect(owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 16 }))
            .rejects.toMatchObject({ code: 'cancelled' });
        await expect(owner.writeStream({
            clientId: 'tab-a',
            streamId: stream.streamId,
            bytes: new Uint8Array([1]),
        })).rejects.toMatchObject({ code: 'cancelled' });
        await expect(owner.finishStreamWrite({ clientId: 'tab-a', streamId: stream.streamId }))
            .rejects.toMatchObject({ code: 'cancelled' });

        // Nothing after the cancel reached the boundary.
        expect(invocations).toEqual(['cancel']);
    });

    it('rejects an operation cancelled mid-flight and lets the retained close run once', async () => {
        // The other half of the same contract: an operation admitted before the
        // cancel loses the race, reports `cancelled`, and the cleanup custody
        // the owner already had still closes the stream exactly once.
        const invocations: string[] = [];
        let releaseRead: (() => void) | null = null;
        const readGate = new Promise<void>((resolve) => {
            releaseRead = resolve;
        });
        const owner = createBrowserIrohSharedEndpointOwner({
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => {
                        invocations.push('read');
                        await readGate;
                        return { bytes: new Uint8Array([9]), done: false };
                    },
                    write: async () => {
                        invocations.push('write');
                    },
                    finishWrite: async () => {
                        invocations.push('finishWrite');
                    },
                    cancel: () => {
                        invocations.push('cancel');
                    },
                    close: async () => {
                        invocations.push('close');
                    },
                }),
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const stream = await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'machine',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });

        const reading = owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 16 });
        await vi.waitFor(() => expect(invocations).toContain('read'));
        await owner.cancelStream({ clientId: 'tab-a', streamId: stream.streamId });

        await expect(reading).rejects.toMatchObject({ code: 'cancelled' });
        releaseRead!();

        await owner.closeStream({ clientId: 'tab-a', streamId: stream.streamId });
        await owner.closeStream({ clientId: 'tab-a', streamId: stream.streamId });
        expect(invocations).toEqual(['read', 'cancel', 'close']);
    });
});
