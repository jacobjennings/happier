import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { BrowserIrohStream } from '../endpointClient';
import {
    BrowserIrohHomeTunnelWebSocket,
    createBrowserIrohHomeTunnelWebSocketFactory,
    type BrowserIrohCarrierCloseEvent,
    type BrowserIrohCarrierErrorEvent,
    type BrowserIrohCarrierMessageEvent,
} from './homeTunnelWebSocket';
import { WEB_SOCKET_ACCEPT_GUID } from './webSocketHandshake';

const HOME_ENDPOINT_ID = 'k51endpointhomeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CARRIER_URL = 'ws://home.happier.test/v1/updates/?EIO=4&transport=websocket';

const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

/**
 * The genuine boundary this carrier sits on: the opaque incremental stream the
 * SharedWorker endpoint owner hands out. It mirrors the real handle's rules —
 * one read and one write in flight, cancellation unblocking a parked read — so
 * everything below it (framing, handshake, lifecycle) stays real.
 */
type FakeHomeTunnelStream = Readonly<{
    stream: BrowserIrohStream;
    written: () => Uint8Array;
    deliver: (bytes: Uint8Array) => void;
    end: () => void;
    readsInFlight: () => number;
    cancelled: () => boolean;
    closed: () => boolean;
    writeFinished: () => boolean;
}>;

function createFakeHomeTunnelStream(remoteEndpointId: string = HOME_ENDPOINT_ID): FakeHomeTunnelStream {
    const writtenChunks: Uint8Array[] = [];
    const inbound: Uint8Array[] = [];
    let ended = false;
    let cancelled = false;
    let closed = false;
    let writeFinished = false;
    let readsInFlight = 0;
    let wake: (() => void) | null = null;

    function wakeReader(): void {
        const pending = wake;
        wake = null;
        pending?.();
    }

    const stream: BrowserIrohStream = {
        streamId: 'stream-1',
        remoteEndpointId,
        observedPath: 'relay',
        read: async (maxBytes) => {
            if (readsInFlight > 0) throw new Error('read_in_progress');
            readsInFlight += 1;
            try {
                for (;;) {
                    if (cancelled || closed) throw new Error('cancelled');
                    const head = inbound[0];
                    if (head !== undefined) {
                        if (head.length <= maxBytes) {
                            inbound.shift();
                            return { bytes: head, done: false };
                        }
                        inbound[0] = head.subarray(maxBytes);
                        return { bytes: head.subarray(0, maxBytes), done: false };
                    }
                    if (ended) return { bytes: new Uint8Array(0), done: true };
                    await new Promise<void>((resolve) => { wake = resolve; });
                }
            } finally {
                readsInFlight -= 1;
            }
        },
        write: async (bytes) => {
            if (cancelled || closed || writeFinished) throw new Error('cancelled');
            writtenChunks.push(new Uint8Array(bytes));
        },
        finishWrite: async () => { writeFinished = true; },
        cancel: async () => { cancelled = true; wakeReader(); },
        close: async () => { closed = true; wakeReader(); },
    };

    return {
        stream,
        written: () => {
            const total = writtenChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const merged = new Uint8Array(total);
            let offset = 0;
            for (const chunk of writtenChunks) {
                merged.set(chunk, offset);
                offset += chunk.length;
            }
            return merged;
        },
        deliver: (bytes) => { inbound.push(bytes); wakeReader(); },
        end: () => { ended = true; wakeReader(); },
        readsInFlight: () => readsInFlight,
        cancelled: () => cancelled,
        closed: () => closed,
        writeFinished: () => writeFinished,
    };
}

/** Independent of the implementation: Node's SHA-1, not the carrier's WebCrypto path. */
function expectedAccept(key: string): string {
    return createHash('sha1').update(`${key}${WEB_SOCKET_ACCEPT_GUID}`).digest('base64');
}

function serverFrame(opcode: number, payload: Uint8Array, fin = true, masked = false): Uint8Array {
    const length = payload.length;
    const indicator = length < 126 ? length : 126;
    const headerBytes = indicator === 126 ? 4 : 2;
    const frame = new Uint8Array(headerBytes + (masked ? 4 : 0) + length);
    const view = new DataView(frame.buffer);
    frame[0] = (fin ? 0x80 : 0) | opcode;
    frame[1] = (masked ? 0x80 : 0) | indicator;
    if (indicator === 126) view.setUint16(2, length);
    if (masked) {
        frame.set([1, 2, 3, 4], headerBytes);
        for (let index = 0; index < length; index += 1) {
            frame[headerBytes + 4 + index] = (payload[index] as number) ^ ([1, 2, 3, 4][index % 4] as number);
        }
    } else {
        frame.set(payload, headerBytes);
    }
    return frame;
}

function closeFrame(code: number, reason = ''): Uint8Array {
    const reasonBytes = new TextEncoder().encode(reason);
    const payload = new Uint8Array(2 + reasonBytes.length);
    new DataView(payload.buffer).setUint16(0, code);
    payload.set(reasonBytes, 2);
    return serverFrame(OPCODE.close, payload);
}

type ClientFrame = Readonly<{ fin: boolean; opcode: number; payload: Uint8Array }>;

/** Decodes what the tab put on the wire, including unmasking. */
function readClientFrames(bytes: Uint8Array): ClientFrame[] {
    const frames: ClientFrame[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    while (offset + 2 <= bytes.length) {
        const first = bytes[offset] as number;
        const second = bytes[offset + 1] as number;
        const masked = (second & 0x80) !== 0;
        let length = second & 0x7f;
        let headerBytes = 2;
        if (length === 126) { length = view.getUint16(offset + 2); headerBytes = 4; }
        else if (length === 127) { length = Number(view.getBigUint64(offset + 2)); headerBytes = 10; }
        const maskOffset = offset + headerBytes;
        const payloadOffset = maskOffset + (masked ? 4 : 0);
        if (payloadOffset + length > bytes.length) break;
        const payload = bytes.slice(payloadOffset, payloadOffset + length);
        if (masked) {
            for (let index = 0; index < length; index += 1) {
                payload[index] = (payload[index] as number) ^ (bytes[maskOffset + (index % 4)] as number);
            }
        }
        frames.push({ fin: (first & 0x80) !== 0, opcode: first & 0x0f, payload });
        offset = payloadOffset + length;
    }
    return frames;
}

async function waitFor<T>(read: () => T | null | undefined | false, label: string): Promise<T> {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const value = read();
        if (value !== null && value !== undefined && value !== false) return value;
        await new Promise((resolve) => { setTimeout(resolve, 1); });
    }
    throw new Error(`timed out waiting for ${label}`);
}

function findHeadEnd(bytes: Uint8Array): number {
    const text = new TextDecoder().decode(bytes);
    const index = text.indexOf('\r\n\r\n');
    return index === -1 ? -1 : index + 4;
}

type CarrierProbe = Readonly<{
    socket: BrowserIrohHomeTunnelWebSocket;
    opened: () => number;
    messages: () => BrowserIrohCarrierMessageEvent['data'][];
    errors: () => BrowserIrohCarrierErrorEvent[];
    closes: () => BrowserIrohCarrierCloseEvent[];
}>;

function observe(socket: BrowserIrohHomeTunnelWebSocket): CarrierProbe {
    let opened = 0;
    const messages: BrowserIrohCarrierMessageEvent['data'][] = [];
    const errors: BrowserIrohCarrierErrorEvent[] = [];
    const closes: BrowserIrohCarrierCloseEvent[] = [];
    socket.onopen = () => { opened += 1; };
    socket.onmessage = (event) => { messages.push(event.data); };
    socket.onerror = (event) => { errors.push(event); };
    socket.onclose = (event) => { closes.push(event); };
    return { socket, opened: () => opened, messages: () => messages, errors: () => errors, closes: () => closes };
}

/** Answers the tab's upgrade request the way Home's listener does. */
async function completeUpgrade(
    fake: FakeHomeTunnelStream,
    overrides: Readonly<{ statusLine?: string; headers?: readonly string[]; accept?: string }> = {},
): Promise<Uint8Array> {
    const request = await waitFor(() => {
        const written = fake.written();
        return findHeadEnd(written) === -1 ? null : written;
    }, 'the upgrade request');
    const text = new TextDecoder().decode(request);
    const key = /sec-websocket-key:\s*(\S+)/i.exec(text)?.[1] ?? '';
    const headers = overrides.headers ?? [
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${overrides.accept ?? expectedAccept(key)}`,
    ];
    const response = [overrides.statusLine ?? 'HTTP/1.1 101 Switching Protocols', ...headers, '', ''].join('\r\n');
    fake.deliver(new TextEncoder().encode(response));
    return request;
}

function connect(fake: FakeHomeTunnelStream, endpointId: string = HOME_ENDPOINT_ID): CarrierProbe {
    return observe(new BrowserIrohHomeTunnelWebSocket({
        url: CARRIER_URL,
        endpointId,
        openStream: async () => fake.stream,
    }));
}

describe('browserIroh/homeCarrier/homeTunnelWebSocket handshake', () => {
    it('performs an HTTP/1.1 upgrade for the Engine.IO path and opens once accepted', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);

        // The carrier never claims a direct path, before or after the upgrade.
        expect(probe.socket.observedPath).toBe('unknown');
        const request = new TextDecoder().decode(await completeUpgrade(fake));
        await waitFor(() => probe.opened() > 0, 'onopen');

        expect(request.split('\r\n')[0]).toBe('GET /v1/updates/?EIO=4&transport=websocket HTTP/1.1');
        expect(request).toMatch(/\r\nHost: home\.happier\.test\r\n/);
        expect(request).toMatch(/\r\nUpgrade: websocket\r\n/);
        expect(request).toMatch(/\r\nConnection: Upgrade\r\n/);
        expect(request).toMatch(/\r\nSec-WebSocket-Version: 13\r\n/);
        // A 16-byte nonce, base64 encoded, per RFC 6455.
        expect(/sec-websocket-key:\s*(\S+)/i.exec(request)?.[1]).toHaveLength(24);
        expect(probe.socket.readyState).toBe(BrowserIrohHomeTunnelWebSocket.OPEN);
        expect(probe.socket.observedPath).toBe('relay');
    });

    it('cancels the stream on an EndpointId mismatch before any byte is written', async () => {
        const fake = createFakeHomeTunnelStream('k51endpointimposteraaaaaaaaaaaaaaaaaaaaaaaaaa');
        const probe = connect(fake);

        await waitFor(() => probe.closes().length > 0, 'onclose');

        expect(fake.written()).toHaveLength(0);
        expect(fake.cancelled() || fake.closed()).toBe(true);
        expect(probe.opened()).toBe(0);
        expect(probe.errors()).toHaveLength(1);
        expect(probe.errors()[0]?.message).toContain('EndpointId');
    });

    it('rejects a non-101 response', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);

        await completeUpgrade(fake, { statusLine: 'HTTP/1.1 502 Bad Gateway', headers: ['Content-Length: 0'] });
        await waitFor(() => probe.closes().length > 0, 'onclose');

        expect(probe.opened()).toBe(0);
        expect(probe.errors()[0]?.message).toContain('502');
    });

    it('rejects a wrong Sec-WebSocket-Accept', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);

        await completeUpgrade(fake, { accept: 'Zm9yZ2VkIGFjY2VwdCB2YWx1ZQ==' });
        await waitFor(() => probe.closes().length > 0, 'onclose');

        expect(probe.opened()).toBe(0);
        expect(probe.errors()[0]?.message).toMatch(/Sec-WebSocket-Accept/i);
    });

    it('rejects an extension or subprotocol it never offered', async () => {
        const withExtension = createFakeHomeTunnelStream();
        const extensionProbe = connect(withExtension);
        const request = new TextDecoder().decode(await waitFor(() => {
            const written = withExtension.written();
            return findHeadEnd(written) === -1 ? null : written;
        }, 'the upgrade request'));
        const key = /sec-websocket-key:\s*(\S+)/i.exec(request)?.[1] ?? '';
        withExtension.deliver(new TextEncoder().encode([
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${expectedAccept(key)}`,
            'Sec-WebSocket-Extensions: permessage-deflate',
            '', '',
        ].join('\r\n')));
        await waitFor(() => extensionProbe.closes().length > 0, 'onclose');

        expect(extensionProbe.opened()).toBe(0);
        expect(extensionProbe.errors()[0]?.message).toMatch(/extension/i);

        const withSubprotocol = createFakeHomeTunnelStream();
        const subprotocolProbe = connect(withSubprotocol);
        const secondRequest = new TextDecoder().decode(await waitFor(() => {
            const written = withSubprotocol.written();
            return findHeadEnd(written) === -1 ? null : written;
        }, 'the upgrade request'));
        const secondKey = /sec-websocket-key:\s*(\S+)/i.exec(secondRequest)?.[1] ?? '';
        withSubprotocol.deliver(new TextEncoder().encode([
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${expectedAccept(secondKey)}`,
            'Sec-WebSocket-Protocol: happier',
            '', '',
        ].join('\r\n')));
        await waitFor(() => subprotocolProbe.closes().length > 0, 'onclose');

        expect(subprotocolProbe.opened()).toBe(0);
        expect(subprotocolProbe.errors()[0]?.message).toMatch(/subprotocol/i);
    });
});

describe('browserIroh/homeCarrier/homeTunnelWebSocket messages', () => {
    it('masks outgoing text and binary payloads', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        const requestBytes = (await completeUpgrade(fake)).length;
        await waitFor(() => probe.opened() > 0, 'onopen');

        probe.socket.send('2probe');
        probe.socket.send(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
        const frames = await waitFor(() => {
            const decoded = readClientFrames(fake.written().subarray(requestBytes));
            return decoded.length >= 2 ? decoded : null;
        }, 'two client frames');

        expect(frames[0]?.opcode).toBe(OPCODE.text);
        expect(new TextDecoder().decode(frames[0]?.payload)).toBe('2probe');
        expect(frames[1]?.opcode).toBe(OPCODE.binary);
        expect([...(frames[1]?.payload ?? [])]).toEqual([0xde, 0xad, 0xbe, 0xef]);
        // Masked on the wire: the raw bytes must not equal the plaintext.
        const raw = fake.written().subarray(requestBytes);
        expect([...raw].join(',')).not.toContain([0xde, 0xad, 0xbe, 0xef].join(','));
    });

    it('reassembles a fragmented server message across an interleaved control frame', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        await completeUpgrade(fake);
        await waitFor(() => probe.opened() > 0, 'onopen');

        fake.deliver(serverFrame(OPCODE.text, new TextEncoder().encode('4{"a":'), false));
        fake.deliver(serverFrame(OPCODE.ping, new Uint8Array([7])));
        fake.deliver(serverFrame(OPCODE.continuation, new TextEncoder().encode('1'), false));
        fake.deliver(serverFrame(OPCODE.continuation, new TextEncoder().encode('}'), true));

        const messages = await waitFor(() => (probe.messages().length > 0 ? probe.messages() : null), 'a message');
        expect(messages[0]).toBe('4{"a":1}');
    });

    it('answers a ping with a masked pong carrying the same application data', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        const requestBytes = (await completeUpgrade(fake)).length;
        await waitFor(() => probe.opened() > 0, 'onopen');

        fake.deliver(serverFrame(OPCODE.ping, new Uint8Array([1, 2, 3])));

        const pong = await waitFor(() => readClientFrames(fake.written().subarray(requestBytes))
            .find((frame) => frame.opcode === OPCODE.pong), 'a pong');
        expect([...pong.payload]).toEqual([1, 2, 3]);
    });

    it('delivers binary frames in the requested binaryType', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        probe.socket.binaryType = 'arraybuffer';
        await completeUpgrade(fake);
        await waitFor(() => probe.opened() > 0, 'onopen');

        fake.deliver(serverFrame(OPCODE.binary, new Uint8Array([4, 2])));

        const messages = await waitFor(() => (probe.messages().length > 0 ? probe.messages() : null), 'a message');
        expect(messages[0]).toBeInstanceOf(ArrayBuffer);
        expect([...new Uint8Array(messages[0] as ArrayBuffer)]).toEqual([4, 2]);
    });
});

describe('browserIroh/homeCarrier/homeTunnelWebSocket lifecycle', () => {
    it('echoes a server close, settles once, and ignores later frames', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        const requestBytes = (await completeUpgrade(fake)).length;
        await waitFor(() => probe.opened() > 0, 'onopen');

        fake.deliver(closeFrame(1000, 'bye'));
        await waitFor(() => probe.closes().length > 0, 'onclose');
        fake.deliver(serverFrame(OPCODE.text, new TextEncoder().encode('late')));
        fake.end();
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(probe.closes()).toHaveLength(1);
        expect(probe.closes()[0]).toMatchObject({ code: 1000, reason: 'bye', wasClean: true });
        expect(probe.messages()).toHaveLength(0);
        expect(readClientFrames(fake.written().subarray(requestBytes)).some((frame) => frame.opcode === OPCODE.close))
            .toBe(true);
        expect(probe.socket.readyState).toBe(BrowserIrohHomeTunnelWebSocket.CLOSED);
    });

    it('stops delivering data frames that trail a close frame in the same read', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        await completeUpgrade(fake);
        await waitFor(() => probe.opened() > 0, 'onopen');

        // One stream read can carry several frames. Once Home has said it is
        // closing, nothing behind that frame is still deliverable.
        const closing = closeFrame(1000, 'bye');
        const trailing = serverFrame(OPCODE.text, new TextEncoder().encode('late'));
        const batch = new Uint8Array(closing.length + trailing.length);
        batch.set(closing);
        batch.set(trailing, closing.length);
        fake.deliver(batch);

        await waitFor(() => probe.closes().length > 0, 'onclose');
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(probe.messages()).toHaveLength(0);
        expect(probe.closes()).toHaveLength(1);
        expect(probe.closes()[0]).toMatchObject({ code: 1000, reason: 'bye' });
    });

    it('reports an unclean close when it is closed before the upgrade completes', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);

        probe.socket.close(1000, 'never opened');

        const closes = await waitFor(() => (probe.closes().length > 0 ? probe.closes() : null), 'onclose');
        await waitFor(() => fake.cancelled() || fake.closed(), 'the stream release');

        expect(probe.opened()).toBe(0);
        expect(fake.written()).toHaveLength(0);
        // A connection that never opened did not close cleanly, and there is no
        // negotiated status to report for it.
        expect(closes).toHaveLength(1);
        expect(closes[0]).toMatchObject({ code: 1006, reason: '', wasClean: false });
        expect(probe.socket.readyState).toBe(BrowserIrohHomeTunnelWebSocket.CLOSED);
    });

    it('reports a malformed server frame once, with no duplicate close', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        await completeUpgrade(fake);
        await waitFor(() => probe.opened() > 0, 'onopen');

        // A masked server-to-client frame is a protocol violation.
        fake.deliver(serverFrame(OPCODE.text, new TextEncoder().encode('nope'), true, true));
        await waitFor(() => probe.closes().length > 0, 'onclose');
        fake.end();
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(probe.errors()).toHaveLength(1);
        expect(probe.closes()).toHaveLength(1);
        expect(probe.closes()[0]?.wasClean).toBe(false);
    });

    it('surfaces an unexpected stream end as an unclean close', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        await completeUpgrade(fake);
        await waitFor(() => probe.opened() > 0, 'onopen');

        fake.end();
        const closes = await waitFor(() => (probe.closes().length > 0 ? probe.closes() : null), 'onclose');

        expect(closes[0]).toMatchObject({ wasClean: false });
        expect(closes).toHaveLength(1);
    });

    it('cancels the held read, finishes and closes the stream, and settles once on close()', async () => {
        const fake = createFakeHomeTunnelStream();
        const probe = connect(fake);
        await completeUpgrade(fake);
        await waitFor(() => probe.opened() > 0, 'onopen');
        await waitFor(() => fake.readsInFlight() === 1, 'a parked read');

        probe.socket.close(1000, 'done');
        probe.socket.close(1000, 'again');
        await waitFor(() => probe.closes().length > 0, 'onclose');
        await waitFor(() => fake.readsInFlight() === 0, 'the read to be released');
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(probe.closes()).toHaveLength(1);
        expect(probe.closes()[0]).toMatchObject({ code: 1000, wasClean: true });
        expect(fake.writeFinished()).toBe(true);
        expect(fake.closed()).toBe(true);
        expect(probe.errors()).toHaveLength(0);
    });

    it('opens a fresh stream per carrier so the existing reconnect owner stays in charge', async () => {
        const streams = [createFakeHomeTunnelStream(), createFakeHomeTunnelStream()];
        let index = 0;
        const factory = createBrowserIrohHomeTunnelWebSocketFactory({
            endpointId: HOME_ENDPOINT_ID,
            openStream: async () => {
                const next = streams[index];
                index += 1;
                if (next === undefined) throw new Error('no stream left');
                return next.stream;
            },
        });

        const first = observe(factory(CARRIER_URL));
        await completeUpgrade(streams[0] as FakeHomeTunnelStream);
        await waitFor(() => first.opened() > 0, 'the first onopen');
        first.socket.close();
        await waitFor(() => first.closes().length > 0, 'the first onclose');

        const second = observe(factory(CARRIER_URL));
        await completeUpgrade(streams[1] as FakeHomeTunnelStream);
        await waitFor(() => second.opened() > 0, 'the second onopen');

        expect(index).toBe(2);
        expect(second.socket.observedPath).toBe('relay');
    });
});
