import { describe, expect, it, vi } from 'vitest';

import { createBrowserIrohEndpointClient } from './endpointClient';
import type { BrowserIrohPageLifecycle } from './pageLifecycleRelease';
import {
    createBrowserIrohSharedEndpointOwner,
    type BrowserIrohEndpointBinder,
    type BrowserIrohEndpointStreamHandle,
} from './sharedEndpointOwner';
import {
    createBrowserIrohWorkerConnectionHandler,
    type BrowserIrohMessagePort,
} from './workerConnection';

const RELAY_A = 'https://relay-a.happier.test';
const RELAY_B = 'https://relay-b.happier.test';

/** The page-lifecycle boundary a tab client listens on, without a DOM. */
function createPageLifecycleStub() {
    const listeners = new Set<(event: Readonly<{ persisted: boolean }>) => void>();
    return {
        lifecycle: {
            addEventListener: (_type: 'pagehide', listener: (event: Readonly<{ persisted: boolean }>) => void) => {
                listeners.add(listener);
            },
            removeEventListener: (_type: 'pagehide', listener: (event: Readonly<{ persisted: boolean }>) => void) => {
                listeners.delete(listener);
            },
        } satisfies BrowserIrohPageLifecycle,
        fire: (persisted = false) => {
            for (const listener of [...listeners]) listener({ persisted });
        },
        listenerCount: () => listeners.size,
    };
}

/**
 * A real message channel between one tab and the worker global, so the typed
 * command boundary is exercised end to end rather than by calling the owner.
 */
function createChannel() {
    const clientListeners: ((event: { data: unknown }) => void)[] = [];
    const workerListeners: ((event: { data: unknown }) => void)[] = [];

    const workerPort: BrowserIrohMessagePort = {
        postMessage: (message) => {
            for (const listener of clientListeners) listener({ data: message });
        },
        addEventListener: (_type, listener) => {
            workerListeners.push(listener);
        },
    };
    const clientPort: BrowserIrohMessagePort = {
        postMessage: (message) => {
            for (const listener of workerListeners) listener({ data: message });
        },
        addEventListener: (_type, listener) => {
            clientListeners.push(listener);
        },
    };

    return { workerPort, clientPort };
}

function createHarness(options: Readonly<{
    openStream?: (input: Readonly<{
        streamKind: 'home' | 'machine';
        endpointId: string;
        relayUrls: readonly string[];
        signal?: AbortSignal;
    }>) => Promise<BrowserIrohEndpointStreamHandle>;
    onConnectionClose?: (input: Readonly<{ streamKind: 'home' | 'machine'; endpointId: string }>) => void;
}> = {}) {
    let binds = 0;
    const closes: string[] = [];
    const streamCalls: string[] = [];
    const bindEndpoint: BrowserIrohEndpointBinder = async ({ relayUrls }) => {
        binds += 1;
        // Mirrors the core's `ensure_relay_urls`: an applied contribution unions
        // into what the endpoint already has, it never replaces it.
        let applied = [...relayUrls];
        const endpointId = `endpoint-${binds}`;
        return {
            endpointId,
            appliedRelayUrls: () => [...applied],
            applyRelayUrls: async (next) => {
                for (const url of next) {
                    if (!applied.includes(url)) applied.push(url);
                }
            },
            openStream: options.openStream ?? (async ({ endpointId }) => ({
                remoteEndpointId: endpointId,
                observedPath: 'relay',
                read: async (maxBytes) => {
                    streamCalls.push(`read:${maxBytes}`);
                    return { bytes: new Uint8Array([3, 4]), done: false };
                },
                write: async (bytes) => {
                    streamCalls.push(`write:${bytes.byteLength}`);
                },
                finishWrite: async () => {
                    streamCalls.push('finish');
                },
                cancel: () => {
                    streamCalls.push('cancel');
                },
                close: async () => {
                    streamCalls.push('close');
                },
            })),
            closeConnection: async (connection) => {
                options.onConnectionClose?.(connection);
            },
            close: async () => {
                closes.push(endpointId);
            },
        };
    };

    const owner = createBrowserIrohSharedEndpointOwner({
        randomBytes: (length) => new Uint8Array(length).fill(5),
        bindEndpoint,
    });

    let clientCounter = 0;
    const handleConnection = createBrowserIrohWorkerConnectionHandler(
        owner,
        () => `client-${(clientCounter += 1)}`,
    );

    const connectTab = (lifecycle: BrowserIrohPageLifecycle | null = null) => {
        const { workerPort, clientPort } = createChannel();
        handleConnection(workerPort);
        return createBrowserIrohEndpointClient(
            () => ({ port: clientPort, onFailure: () => {} }),
            lifecycle,
        );
    };

    /**
     * A port without the tab client on top of it: any script on the origin can
     * post whatever it likes, which is exactly what lease custody has to hold
     * against.
     */
    const connectRawTab = () => {
        const { workerPort, clientPort } = createChannel();
        handleConnection(workerPort);
        let counter = 0;
        return (command: Record<string, unknown>): Promise<Record<string, unknown>> =>
            new Promise((resolve) => {
                const requestId = `raw-${(counter += 1)}`;
                clientPort.addEventListener('message', (event) => {
                    const reply = event.data as Record<string, unknown>;
                    if (reply.requestId === requestId) resolve(reply);
                });
                clientPort.postMessage({ v: 1, requestId, ...command });
            });
    };

    return {
        connectTab,
        connectRawTab,
        binds: () => binds,
        closes,
        streamCalls,
    };
}

describe('sync/runtime/browserIroh/workerConnection', () => {
    it('cancels only the pending WASM open and closes a handle that wins the cancellation race', async () => {
        let settleOpen!: (value: BrowserIrohEndpointStreamHandle) => void;
        const pendingOpen = new Promise<BrowserIrohEndpointStreamHandle>((resolve) => {
            settleOpen = resolve;
        });
        let cancelledSignal: AbortSignal | undefined;
        const close = vi.fn(async () => undefined);
        const harness = createHarness({
            openStream: async ({ endpointId, signal }) => {
                if (endpointId === 'cancelled-target') {
                    cancelledSignal = signal;
                    return await pendingOpen;
                }
                return {
                    remoteEndpointId: endpointId, observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {}, finishWrite: async () => {}, cancel: () => {}, close: async () => {},
                };
            },
        });
        const tabA = harness.connectTab();
        const tabB = harness.connectTab();
        const leaseA = await tabA.acquireLease([RELAY_A]);
        const leaseB = await tabB.acquireLease([RELAY_A]);
        const controller = new AbortController();
        const opening = leaseA.openStream({
            streamKind: 'machine', endpointId: 'cancelled-target', relayUrls: [RELAY_A], signal: controller.signal,
        });
        await vi.waitFor(() => expect(cancelledSignal).toBeDefined());
        controller.abort(new Error('cancelled'));

        await expect(opening).rejects.toThrow('cancelled');
        expect(cancelledSignal?.aborted).toBe(true);
        const sibling = await leaseB.openStream({
            streamKind: 'machine', endpointId: 'sibling-target', relayUrls: [RELAY_A],
        });
        await expect(sibling.write(new Uint8Array([1]))).resolves.toBeUndefined();
        settleOpen({
            remoteEndpointId: 'cancelled-target', observedPath: 'relay',
            read: async () => ({ bytes: new Uint8Array(), done: true }),
            write: async () => {}, finishWrite: async () => {}, cancel: () => {}, close,
        });
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    });

    it('cancels and joins a pending cold dial before acknowledging that lease release', async () => {
        // A release that acknowledges while a dial is still in flight tells the
        // caller the carrier is gone while the endpoint may still be about to
        // hold a live connection to the peer. The pending open this port already
        // tracks is what makes the acknowledgement truthful.
        let settleOpen!: (value: BrowserIrohEndpointStreamHandle) => void;
        const pendingOpen = new Promise<BrowserIrohEndpointStreamHandle>((resolve) => {
            settleOpen = resolve;
        });
        let dialSignal: AbortSignal | undefined;
        const events: string[] = [];
        const harness = createHarness({
            openStream: async ({ endpointId, signal }) => {
                if (endpointId === 'cold-target') {
                    dialSignal = signal;
                    return await pendingOpen;
                }
                return {
                    remoteEndpointId: endpointId, observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {}, finishWrite: async () => {}, cancel: () => {}, close: async () => {},
                };
            },
            onConnectionClose: ({ streamKind, endpointId }) => {
                events.push(`connection:${streamKind}:${endpointId}`);
            },
        });
        const tab = harness.connectTab();
        const dialing = await tab.acquireLease([RELAY_A]);
        const sibling = await tab.acquireLease([RELAY_A]);
        const opening = dialing.openStream({
            streamKind: 'machine', endpointId: 'cold-target', relayUrls: [RELAY_A],
        });
        await vi.waitFor(() => expect(dialSignal).toBeDefined());

        // Another lease on the same port is a different operation entirely.
        await sibling.release();
        expect(dialSignal?.aborted).toBe(false);

        const releasing = dialing.release().then(() => {
            events.push('released');
        });
        await vi.waitFor(() => expect(dialSignal?.aborted).toBe(true));
        // The dial wins the cancellation race and produces a real handle.
        settleOpen({
            remoteEndpointId: 'cold-target', observedPath: 'relay',
            read: async () => ({ bytes: new Uint8Array(), done: true }),
            write: async () => {}, finishWrite: async () => {}, cancel: () => {},
            close: async () => {
                events.push('stream');
            },
        });

        await expect(opening).rejects.toMatchObject({ code: 'cancelled' });
        await releasing;
        expect(events).toEqual(['stream', 'connection:machine:cold-target', 'released']);
        await expect(tab.status()).resolves.toMatchObject({ leaseCount: 0 });
    });

    it('joins this port’s pending dial on releaseAll and leaves a sibling tab’s dial alone', async () => {
        const dials = new Map<string, {
            signal: AbortSignal | undefined;
            settle: (value: BrowserIrohEndpointStreamHandle) => void;
        }>();
        const events: string[] = [];
        const harness = createHarness({
            openStream: async ({ endpointId, signal }) => await new Promise<BrowserIrohEndpointStreamHandle>((resolve) => {
                dials.set(endpointId, { signal, settle: resolve });
            }),
            onConnectionClose: ({ endpointId }) => {
                events.push(`connection:${endpointId}`);
            },
        });
        const tabA = harness.connectTab();
        const tabB = harness.connectTab();
        const leaseA = await tabA.acquireLease([RELAY_A]);
        const leaseB = await tabB.acquireLease([RELAY_A]);
        const openingA = leaseA.openStream({ streamKind: 'machine', endpointId: 'target-a', relayUrls: [RELAY_A] });
        void leaseB.openStream({ streamKind: 'machine', endpointId: 'target-b', relayUrls: [RELAY_A] });
        await vi.waitFor(() => expect(dials.size).toBe(2));

        const releasing = tabA.releaseAll().then(() => {
            events.push('releasedAll');
        });
        await vi.waitFor(() => expect(dials.get('target-a')?.signal?.aborted).toBe(true));
        expect(dials.get('target-b')?.signal?.aborted).toBe(false);
        dials.get('target-a')!.settle({
            remoteEndpointId: 'target-a', observedPath: 'relay',
            read: async () => ({ bytes: new Uint8Array(), done: true }),
            write: async () => {}, finishWrite: async () => {}, cancel: () => {},
            close: async () => {
                events.push('stream:target-a');
            },
        });

        await expect(openingA).rejects.toMatchObject({ code: 'cancelled' });
        await releasing;
        expect(events).toEqual(['stream:target-a', 'connection:target-a', 'releasedAll']);
        await expect(tabB.status()).resolves.toMatchObject({ leaseCount: 1 });
    });

    it('keeps incremental stream handles opaque and scoped to the acquiring tab', async () => {
        const harness = createHarness();
        const tabA = harness.connectTab();
        const tabB = harness.connectTab();
        const lease = await tabA.acquireLease([RELAY_A]);
        const stream = await lease.openStream({
            streamKind: 'home',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });

        expect(stream.remoteEndpointId).toBe('endpoint-remote');
        expect(stream.observedPath).toBe('relay');
        await expect(stream.read(8)).resolves.toEqual({ bytes: new Uint8Array([3, 4]), done: false });
        await stream.write(new Uint8Array([1, 2, 3]));
        await stream.finishWrite();

        const sibling = harness.connectRawTab();
        await expect(sibling({ kind: 'closeStream', streamId: stream.streamId })).resolves.toMatchObject({
            kind: 'error',
            code: 'unknown_stream',
        });
        await expect(tabB.status()).resolves.toMatchObject({ leaseCount: 1 });

        await stream.cancel();
        await stream.close();
        await stream.close();
        expect(harness.streamCalls).toEqual(['read:8', 'write:3', 'finish', 'cancel', 'close']);
    });
    it('scopes a lease release to the port that acquired it', async () => {
        // The worker names the client; a lease id travelling over the wire is
        // not enough to release it. A hostile or merely confused port that
        // replays a sibling's lease id is refused without being told the lease
        // exists, and the sibling keeps holding it.
        const harness = createHarness();
        const tab = harness.connectTab();
        const send = harness.connectRawTab();
        const lease = await tab.acquireLease([RELAY_A]);

        await expect(send({ kind: 'releaseLease', leaseId: lease.leaseId })).resolves.toMatchObject({
            kind: 'error',
            code: 'unknown_lease',
        });
        await expect(tab.status()).resolves.toMatchObject({ state: 'ready', leaseCount: 1 });

        // The owning tab still releases it, and repeating that is success.
        await expect(lease.release()).resolves.toBeUndefined();
        await expect(lease.release()).resolves.toBeUndefined();
        await expect(tab.status()).resolves.toMatchObject({ state: 'ready', leaseCount: 0 });
        expect(harness.closes).toEqual([]);
    });

    it('releases this tab’s leases when the page goes away, leaving the sibling untouched', async () => {
        // A SharedWorker may stay live for siblings: a reload or a tab close that says
        // nothing would leave a lease held by a client id no port answers for.
        const harness = createHarness();
        const pagehide = createPageLifecycleStub();
        const tabA = harness.connectTab(pagehide.lifecycle);
        const tabB = harness.connectTab();
        await tabA.acquireLease([RELAY_A]);
        const leaseB = await tabB.acquireLease([RELAY_A]);

        pagehide.fire();

        // Page teardown is deliberately best-effort and cannot await the
        // worker command. Observe its asynchronous settlement rather than
        // assuming the message handler completed in the same tick.
        await vi.waitFor(async () => {
            await expect(tabB.status()).resolves.toMatchObject({
                state: 'ready',
                endpointId: leaseB.endpointId,
                leaseCount: 1,
            });
        });
        // Client release is not endpoint teardown while the worker remains live.
        expect(harness.closes).toEqual([]);
    });

    it('reports the endpoint’s applied relay union on a lease acquired over the port', async () => {
        const harness = createHarness();
        const tab = harness.connectTab();
        const lease = await tab.acquireLease([RELAY_A]);

        const second = await tab.acquireLease([RELAY_B]);

        expect(harness.binds()).toBe(1);
        expect(second.endpointId).toBe(lease.endpointId);
        expect(second.appliedRelayUrls).toEqual([RELAY_A, RELAY_B]);
    });

    it('surfaces the relay-only requirement as a typed error', async () => {
        const harness = createHarness();
        const tab = harness.connectTab();

        await expect(tab.acquireLease([])).rejects.toMatchObject({ code: 'relay_required' });
        expect(harness.binds()).toBe(0);
    });

    it('refuses an unrecognized message on the port instead of reaching the owner', () => {
        // The port is reachable by any script on the origin, so an unrecognized
        // message must be refused rather than guessed at. This binder fails the
        // test if the owner is ever reached.
        const bindEndpoint = vi.fn<BrowserIrohEndpointBinder>(async () => {
            throw new Error('the endpoint must never be reached');
        });
        const { workerPort, clientPort } = createChannel();
        const replies: unknown[] = [];
        clientPort.addEventListener('message', (event) => {
            replies.push(event.data);
        });
        createBrowserIrohWorkerConnectionHandler(
            createBrowserIrohSharedEndpointOwner({
                randomBytes: (length) => new Uint8Array(length),
                bindEndpoint,
            }),
        )(workerPort);

        // An unknown command kind, a command from a future protocol version, and
        // the removed `configureRelays` IPC (Lane 06 amendment A10).
        clientPort.postMessage({ v: 1, kind: 'openTunnel', requestId: 'r-1' });
        clientPort.postMessage({ v: 2, kind: 'acquireLease', requestId: 'r-2', relayUrls: [] });
        clientPort.postMessage({ v: 1, kind: 'configureRelays', requestId: 'r-3', relayUrls: [RELAY_B] });

        expect(bindEndpoint).not.toHaveBeenCalled();

        expect(replies).toEqual([
            { v: 1, kind: 'error', requestId: 'r-1', code: 'protocol_violation', message: 'Unrecognized browser Iroh command' },
            { v: 1, kind: 'error', requestId: 'r-2', code: 'protocol_violation', message: 'Unrecognized browser Iroh command' },
            { v: 1, kind: 'error', requestId: 'r-3', code: 'protocol_violation', message: 'Unrecognized browser Iroh command' },
        ]);
    });
});
