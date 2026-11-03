import { describe, expect, it, vi } from 'vitest';

import { createBrowserIrohWasmBinder } from './wasmBinder';

const SEED = new Uint8Array(32).fill(9);
const RELAY = 'https://relay.happier.test';

/**
 * Stands in for the generated wasm-bindgen module. wasm-bindgen exports a
 * class, not a plain object, so the export here is a class with a static
 * `create` and prototype probe methods — the exact shape the boundary check
 * requires. `create` copies the seed synchronously when invoked — the real
 * boundary converts the JS `Uint8Array` into wasm linear memory before its
 * returned Promise settles — and keeps that copy so a test can tell "zeroed
 * too early" (the copy would be zeros) from "zeroed after the boundary
 * consumed it".
 */
function createFakeModule() {
    const created: { seedCopy: Uint8Array }[] = [];
    const closedConnections: string[] = [];
    const closedStreams: number[] = [];
    const openCancellations: { cancelled: boolean }[] = [];
    let endpointIdImpl = (): unknown => 'endpoint-fake';
    let streamRemoteEndpointIdImpl = (_streamHandle: number): unknown => 'endpoint-remote';
    let streamObservedPathImpl = (_streamHandle: number): unknown => 'relay';
    let probeCloseCount = 0;

    class FakeHappierBrowserIrohOpenCancellation {
        readonly state = { cancelled: false };

        constructor() {
            openCancellations.push(this.state);
        }

        cancel(): void {
            this.state.cancelled = true;
        }
    }

    class FakeHappierBrowserIrohProbe {
        static create(secretKey: Uint8Array, _relayUrls: string[]): Promise<unknown> {
            created.push({ seedCopy: new Uint8Array(secretKey) });
            return createImpl();
        }

        // The full shape `narrowProbe` requires of a created probe, so a
        // failure here can only be about the behavior under test, not the
        // boundary check.
        endpointId(): string {
            return endpointIdImpl() as string;
        }

        appliedRelayUrls(): string[] {
            return [];
        }

        async applyRelayUrls(_relayUrls: string[]): Promise<void> {}

        async openIncrementalHomeTunnelStream(
            _endpointId: string,
            _relayUrls: string[],
            cancellation: FakeHappierBrowserIrohOpenCancellation,
        ): Promise<number> {
            await vi.waitFor(() => expect(cancellation.state.cancelled).toBe(true));
            return 1;
        }

        async openIncrementalMachineStream(_endpointId: string, _relayUrls: string[]): Promise<number> {
            return 2;
        }

        streamRemoteEndpointId(_streamHandle: number): string {
            return streamRemoteEndpointIdImpl(_streamHandle) as string;
        }

        streamObservedPath(_streamHandle: number): string {
            return streamObservedPathImpl(_streamHandle) as string;
        }

        async readStream(_streamHandle: number, _maxBytes: number): Promise<Uint8Array | null> {
            return null;
        }

        async writeStream(_streamHandle: number, _bytes: Uint8Array): Promise<void> {}

        async finishStreamWrite(_streamHandle: number): Promise<void> {}

        cancelStream(_streamHandle: number): void {}

        async closeStream(streamHandle: number): Promise<void> {
            closedStreams.push(streamHandle);
        }

        closeHomeTunnelConnection(endpointId: string): void {
            closedConnections.push(`home:${endpointId}`);
        }

        closeMachineConnection(endpointId: string): void {
            closedConnections.push(`machine:${endpointId}`);
        }

        async close(): Promise<void> {
            probeCloseCount += 1;
        }
    }

    let createImpl: () => Promise<unknown> = async () => new FakeHappierBrowserIrohProbe();

    const module = {
        default: async () => 'initialized',
        HappierBrowserIrohProbe: FakeHappierBrowserIrohProbe,
        HappierBrowserIrohOpenCancellation: FakeHappierBrowserIrohOpenCancellation,
    };

    return {
        module,
        created,
        closedConnections,
        closedStreams,
        openCancellations,
        probeCloseCount: () => probeCloseCount,
        failCreateWith: (error: Error) => {
            createImpl = async () => {
                throw error;
            };
        },
        setEndpointId: (value: unknown) => {
            endpointIdImpl = () => value;
        },
        failEndpointIdWith: (error: Error) => {
            endpointIdImpl = () => {
                throw error;
            };
        },
        setStreamRemoteEndpointId: (value: unknown) => {
            streamRemoteEndpointIdImpl = () => value;
        },
        failStreamRemoteEndpointIdWith: (error: Error) => {
            streamRemoteEndpointIdImpl = () => {
                throw error;
            };
        },
        setStreamObservedPath: (value: unknown) => {
            streamObservedPathImpl = () => value;
        },
        failStreamObservedPathWith: (error: Error) => {
            streamObservedPathImpl = () => {
                throw error;
            };
        },
    };
}

describe('sync/runtime/browserIroh/wasmBinder', () => {
    it('zeroes the JS seed only after the create boundary has consumed it, on success', async () => {
        const fake = createFakeModule();
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const seed = new Uint8Array(SEED);

        const handle = await binder({ secretKey: seed, relayUrls: [RELAY] });

        expect(handle.endpointId).toBe('endpoint-fake');
        // The boundary saw the real seed, not a zeroed buffer.
        expect(fake.created).toHaveLength(1);
        expect(fake.created[0]!.seedCopy).toEqual(SEED);
        // And the JS copy is wiped once the boundary has taken it.
        expect(seed.every((byte) => byte === 0)).toBe(true);
    });

    it('zeroes the JS seed when the create boundary rejects', async () => {
        const fake = createFakeModule();
        fake.failCreateWith(new Error('bind failed'));
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const seed = new Uint8Array(SEED);

        await expect(binder({ secretKey: seed, relayUrls: [RELAY] })).rejects.toThrow('bind failed');
        expect(fake.created[0]!.seedCopy).toEqual(SEED);
        expect(seed.every((byte) => byte === 0)).toBe(true);
    });

    it('zeroes the JS seed when the create boundary throws synchronously', async () => {
        const fake = createFakeModule();
        fake.module.HappierBrowserIrohProbe.create = () => {
            throw new Error('wasm trap');
        };
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const seed = new Uint8Array(SEED);

        await expect(binder({ secretKey: seed, relayUrls: [RELAY] })).rejects.toThrow('wasm trap');
        expect(seed.every((byte) => byte === 0)).toBe(true);
    });

    it('routes typed connection release to the protocol-specific wasm operation', async () => {
        const fake = createFakeModule();
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const handle = await binder({ secretKey: new Uint8Array(SEED), relayUrls: [RELAY] });

        await handle.closeConnection({ streamKind: 'home', endpointId: 'home-endpoint' });
        await handle.closeConnection({ streamKind: 'machine', endpointId: 'machine-endpoint' });

        expect(fake.closedConnections).toEqual([
            'home:home-endpoint',
            'machine:machine-endpoint',
        ]);
    });

    it('propagates one aborted open to its per-operation WASM cancellation handle', async () => {
        const fake = createFakeModule();
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const handle = await binder({ secretKey: new Uint8Array(SEED), relayUrls: [RELAY] });
        const controller = new AbortController();
        const opening = handle.openStream({
            streamKind: 'home', endpointId: 'home-endpoint', relayUrls: [RELAY], signal: controller.signal,
        });

        await vi.waitFor(() => expect(fake.openCancellations).toHaveLength(1));
        controller.abort();

        await expect(opening).resolves.toMatchObject({ remoteEndpointId: 'endpoint-remote' });
        expect(fake.openCancellations).toEqual([{ cancelled: true }]);
    });

    it.each([
        ['malformed remote EndpointId', (fake: ReturnType<typeof createFakeModule>) => fake.setStreamRemoteEndpointId('')],
        [
            'throwing remote EndpointId accessor',
            (fake: ReturnType<typeof createFakeModule>) => fake.failStreamRemoteEndpointIdWith(new Error('remote id trap')),
        ],
        ['malformed observed path', (fake: ReturnType<typeof createFakeModule>) => fake.setStreamObservedPath('direct')],
        [
            'throwing observed path accessor',
            (fake: ReturnType<typeof createFakeModule>) => fake.failStreamObservedPathWith(new Error('path trap')),
        ],
    ])('closes the raw stream when %s prevents handle publication', async (_label, arrange) => {
        const fake = createFakeModule();
        arrange(fake);
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const handle = await binder({ secretKey: new Uint8Array(SEED), relayUrls: [RELAY] });

        await expect(handle.openStream({
            streamKind: 'machine', endpointId: 'machine-endpoint', relayUrls: [RELAY],
        })).rejects.toThrow();

        expect(fake.closedStreams).toEqual([2]);
    });

    it.each([
        ['malformed endpoint id', (fake: ReturnType<typeof createFakeModule>) => fake.setEndpointId('')],
        [
            'throwing endpoint id accessor',
            (fake: ReturnType<typeof createFakeModule>) => fake.failEndpointIdWith(new Error('endpoint id trap')),
        ],
    ])('closes the probe when %s prevents endpoint publication', async (_label, arrange) => {
        const fake = createFakeModule();
        arrange(fake);
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));

        await expect(binder({ secretKey: new Uint8Array(SEED), relayUrls: [RELAY] })).rejects.toThrow();

        expect(fake.probeCloseCount()).toBe(1);
    });
});
