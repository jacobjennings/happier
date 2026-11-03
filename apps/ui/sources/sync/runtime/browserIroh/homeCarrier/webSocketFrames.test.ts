import { describe, expect, it } from 'vitest';

import {
    WEB_SOCKET_CLOSE_CODE,
    WEB_SOCKET_MAX_MESSAGE_PAYLOAD_BYTES,
    WEB_SOCKET_OPCODE,
    WebSocketFrameDecoder,
    WebSocketProtocolError,
    encodeMaskedClientFrame,
    secureWebSocketMask,
} from './webSocketFrames';
import type { WebSocketFrame } from './webSocketFrames';

/**
 * Builds a server-to-client frame the way a compliant server does: unmasked.
 * The production encoder cannot produce one, so this is a genuine independent
 * fixture rather than a second copy of the code under test.
 */
function serverFrame(
    opcode: number,
    payload: Uint8Array,
    options: Readonly<{ fin?: boolean; masked?: boolean; reserved?: number; forceLength?: 126 | 127 }> = {},
): Uint8Array {
    const fin = options.fin ?? true;
    const masked = options.masked ?? false;
    const length = payload.length;
    const indicator = options.forceLength ?? (length < 126 ? length : length < 0x1_0000 ? 126 : 127);
    const headerBytes = indicator === 127 ? 10 : indicator === 126 ? 4 : 2;
    const frame = new Uint8Array(headerBytes + (masked ? 4 : 0) + length);
    const view = new DataView(frame.buffer);
    frame[0] = (fin ? 0x80 : 0) | ((options.reserved ?? 0) << 4) | opcode;
    frame[1] = (masked ? 0x80 : 0) | indicator;
    if (indicator === 126) view.setUint16(2, length);
    if (indicator === 127) view.setBigUint64(2, BigInt(length));
    if (masked) {
        const mask = new Uint8Array([1, 2, 3, 4]);
        frame.set(mask, headerBytes);
        for (let index = 0; index < length; index += 1) {
            frame[headerBytes + 4 + index] = (payload[index] as number) ^ (mask[index % 4] as number);
        }
    } else {
        frame.set(payload, headerBytes);
    }
    return frame;
}

function bigServerFrame(opcode: number, announcedLength: bigint): Uint8Array {
    const frame = new Uint8Array(10);
    const view = new DataView(frame.buffer);
    frame[0] = 0x80 | opcode;
    frame[1] = 127;
    view.setBigUint64(2, announcedLength);
    return frame;
}

describe('browserIroh/homeCarrier/webSocketFrames client encoding', () => {
    it('masks every client frame with the supplied key and a 7-bit length', () => {
        const mask = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
        const payload = new Uint8Array([0x01, 0x02, 0x03]);

        const frame = encodeMaskedClientFrame(WEB_SOCKET_OPCODE.text, payload, mask);

        expect([...frame]).toEqual([
            0x81,
            0x80 | 3,
            0xaa, 0xbb, 0xcc, 0xdd,
            0x01 ^ 0xaa, 0x02 ^ 0xbb, 0x03 ^ 0xcc,
        ]);
    });

    it('uses 16-bit and 64-bit extended lengths at the specification boundaries', () => {
        const mask = new Uint8Array([0, 0, 0, 0]);

        const medium = encodeMaskedClientFrame(WEB_SOCKET_OPCODE.binary, new Uint8Array(126), mask);
        expect(medium[1]).toBe(0x80 | 126);
        expect(new DataView(medium.buffer).getUint16(2)).toBe(126);

        const large = encodeMaskedClientFrame(WEB_SOCKET_OPCODE.binary, new Uint8Array(0x1_0000), mask);
        expect(large[1]).toBe(0x80 | 127);
        expect(new DataView(large.buffer).getBigUint64(2)).toBe(BigInt(0x1_0000));
    });

    it('draws a fresh secure mask per frame instead of a constant', () => {
        const payload = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
        const first = encodeMaskedClientFrame(WEB_SOCKET_OPCODE.text, payload);
        const second = encodeMaskedClientFrame(WEB_SOCKET_OPCODE.text, payload);

        expect(secureWebSocketMask()).toHaveLength(4);
        // An all-zero mask would be a valid but non-random key, and the two
        // frames would be byte-identical.
        expect([...first.slice(2, 6)]).not.toEqual([0, 0, 0, 0]);
        expect([...first]).not.toEqual([...second]);
    });

    it('refuses to emit an oversized control frame', () => {
        expect(() => encodeMaskedClientFrame(
            WEB_SOCKET_OPCODE.ping,
            new Uint8Array(126),
            new Uint8Array([1, 2, 3, 4]),
        )).toThrow(WebSocketProtocolError);
    });
});

describe('browserIroh/homeCarrier/webSocketFrames server decoding', () => {
    it('reassembles frames split across stream reads and splits a coalesced read', () => {
        const decoder = new WebSocketFrameDecoder();
        const first = serverFrame(WEB_SOCKET_OPCODE.text, new TextEncoder().encode('hello'));
        const second = serverFrame(WEB_SOCKET_OPCODE.binary, new Uint8Array([9, 9]));
        const wire = new Uint8Array(first.length + second.length);
        wire.set(first);
        wire.set(second, first.length);

        expect(decoder.push(wire.slice(0, 3))).toEqual([]);
        const frames = decoder.push(wire.slice(3));

        expect(frames).toHaveLength(2);
        expect(frames[0]).toMatchObject({ fin: true, opcode: WEB_SOCKET_OPCODE.text });
        expect(new TextDecoder().decode(frames[0]?.payload)).toBe('hello');
        expect([...(frames[1]?.payload ?? [])]).toEqual([9, 9]);
    });

    it('decodes a 16-bit extended length', () => {
        const decoder = new WebSocketFrameDecoder();
        const payload = new Uint8Array(300).fill(7);

        const frames = decoder.push(serverFrame(WEB_SOCKET_OPCODE.binary, payload));

        expect(frames[0]?.payload).toHaveLength(300);
    });

    it('retains incomplete frame chunks and copies a multi-megabyte payload only when complete', () => {
        const decoder = new WebSocketFrameDecoder();
        const payload = new Uint8Array(2 * 1024 * 1024).fill(7);
        const wire = serverFrame(WEB_SOCKET_OPCODE.binary, payload);
        let frames: WebSocketFrame[] = [];

        for (let offset = 0; offset < wire.length; offset += 64 * 1024) {
            frames = decoder.push(wire.subarray(offset, offset + 64 * 1024));
            // No frame surfaces until its final chunk arrives.
            if (offset + 64 * 1024 < wire.length) expect(frames).toEqual([]);
        }

        expect(frames).toHaveLength(1);
        expect(frames[0]?.payload).toEqual(payload);
    });

    it('reassembles a fragmented message at the exact Socket.IO boundary across control frames', () => {
        const decoder = new WebSocketFrameDecoder();
        const firstLength = Math.floor(WEB_SOCKET_MAX_MESSAGE_PAYLOAD_BYTES / 2);
        const secondLength = WEB_SOCKET_MAX_MESSAGE_PAYLOAD_BYTES - firstLength;

        expect(decoder.push(serverFrame(
            WEB_SOCKET_OPCODE.binary,
            new Uint8Array(firstLength).fill(1),
            { fin: false },
        ))).toEqual([]);
        expect(decoder.push(serverFrame(WEB_SOCKET_OPCODE.ping, new Uint8Array([9])))).toEqual([
            expect.objectContaining({ opcode: WEB_SOCKET_OPCODE.ping, payload: new Uint8Array([9]) }),
        ]);

        const frames = decoder.push(serverFrame(
            WEB_SOCKET_OPCODE.continuation,
            new Uint8Array(secondLength).fill(2),
        ));

        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({ fin: true, opcode: WEB_SOCKET_OPCODE.binary });
        expect(frames[0]?.payload).toHaveLength(WEB_SOCKET_MAX_MESSAGE_PAYLOAD_BYTES);
        expect(frames[0]?.payload[firstLength - 1]).toBe(1);
        expect(frames[0]?.payload[firstLength]).toBe(2);
    });

    it('rejects and releases fragmented-message retention one byte over the boundary', () => {
        const decoder = new WebSocketFrameDecoder();

        expect(decoder.push(serverFrame(
            WEB_SOCKET_OPCODE.text,
            new Uint8Array(WEB_SOCKET_MAX_MESSAGE_PAYLOAD_BYTES),
            { fin: false },
        ))).toEqual([]);
        expect(() => decoder.push(serverFrame(
            WEB_SOCKET_OPCODE.continuation,
            new Uint8Array([1]),
        ))).toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.messageTooBig }));

        expect(() => decoder.push(serverFrame(
            WEB_SOCKET_OPCODE.continuation,
            new Uint8Array(0),
        ))).toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.protocolError }));
    });

    it('rejects an announced over-boundary frame from its header and releases buffered retention', () => {
        const decoder = new WebSocketFrameDecoder();
        const oversizedHeader = bigServerFrame(
            WEB_SOCKET_OPCODE.binary,
            BigInt(WEB_SOCKET_MAX_MESSAGE_PAYLOAD_BYTES + 1),
        );

        expect(() => decoder.push(oversizedHeader))
            .toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.messageTooBig }));

        const frames = decoder.push(serverFrame(WEB_SOCKET_OPCODE.text, new Uint8Array([1])));
        expect(frames).toEqual([
            expect.objectContaining({ opcode: WEB_SOCKET_OPCODE.text, payload: new Uint8Array([1]) }),
        ]);
    });

    it('rejects a masked server frame', () => {
        const decoder = new WebSocketFrameDecoder();
        expect(() => decoder.push(serverFrame(WEB_SOCKET_OPCODE.text, new Uint8Array([1]), { masked: true })))
            .toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.protocolError }));
    });

    it('rejects reserved bits without a negotiated extension', () => {
        const decoder = new WebSocketFrameDecoder();
        expect(() => decoder.push(serverFrame(WEB_SOCKET_OPCODE.text, new Uint8Array([1]), { reserved: 0b100 })))
            .toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.protocolError }));
    });

    it('rejects an unknown opcode', () => {
        const decoder = new WebSocketFrameDecoder();
        expect(() => decoder.push(serverFrame(0x3, new Uint8Array([1]))))
            .toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.protocolError }));
    });

    it('rejects a fragmented control frame', () => {
        const decoder = new WebSocketFrameDecoder();
        expect(() => decoder.push(serverFrame(WEB_SOCKET_OPCODE.ping, new Uint8Array([1]), { fin: false })))
            .toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.protocolError }));
    });

    it('rejects an oversized control frame before waiting for its payload', () => {
        const decoder = new WebSocketFrameDecoder();
        const header = serverFrame(WEB_SOCKET_OPCODE.ping, new Uint8Array(200)).slice(0, 4);

        expect(() => decoder.push(header))
            .toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.protocolError }));
    });

    it('rejects a 64-bit length this runtime cannot address', () => {
        const decoder = new WebSocketFrameDecoder();
        expect(() => decoder.push(bigServerFrame(WEB_SOCKET_OPCODE.binary, BigInt('0x7FFFFFFFFFFFFFFF'))))
            .toThrow(expect.objectContaining({ closeCode: WEB_SOCKET_CLOSE_CODE.messageTooBig }));
    });
});
