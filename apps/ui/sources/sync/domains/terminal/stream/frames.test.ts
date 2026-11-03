import { describe, expect, it } from 'vitest';

import { mapLegacyTerminalReadResponse, mapTerminalBytesFrame, mapTerminalByteStreamReadResponse } from './frames';

describe('terminal stream frames', () => {
    it('carries retained bounds separately from page progress even when no gap is emitted', () => {
        const result = mapTerminalByteStreamReadResponse({ ok: true, terminalId: 'finished', frames: [],
            nextByteOffset: 200, availableByteOffset: 2500, droppedBeforeByteOffset: 100, done: false });
        expect(result).toMatchObject({ nextCursor: 200, done: false, outputRetention: {
            mode: 'byte-offset', retainedFromCursor: 100, availableCursor: 2500, truncated: true,
        } });
        expect(mapTerminalByteStreamReadResponse({ ok: true, terminalId: 'complete', frames: [],
            nextByteOffset: 2500, availableByteOffset: 2500, droppedBeforeByteOffset: 0, done: true }))
            .toMatchObject({ done: true, outputRetention: { retainedFromCursor: 0, availableCursor: 2500, truncated: false } });
    });
    it('maps legacy string data into byte frames without treating strings as renderer payloads', () => {
        const result = mapLegacyTerminalReadResponse({
            terminalId: 'term-1',
            cursor: 7,
            response: {
                ok: true,
                terminalId: 'term-1',
                events: [
                    { t: 'data', data: 'héllo' },
                    { t: 'gap', droppedBefore: 4 },
                    { t: 'exit', exitCode: 0, signal: null },
                ],
                nextCursor: 10,
                done: true,
            },
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            terminalId: 'term-1',
            nextCursor: 10,
            done: true,
            mode: 'legacy-event-cursor',
        }));
        if (!result.ok) throw new Error('expected ok response');
        expect(result.frames[0]).toEqual(expect.objectContaining({
            t: 'bytes',
            terminalId: 'term-1',
            source: 'legacy-string',
            byteLength: 6,
        }));
        expect(result.frames[1]).toEqual(expect.objectContaining({ t: 'gap', droppedBefore: 4 }));
        expect(result.frames[2]).toEqual(expect.objectContaining({ t: 'exit', exitCode: 0 }));
    });

    it('decodes base64 byte frames and validates decoded length', () => {
        const mapped = mapTerminalBytesFrame({
            t: 'bytes',
            terminalId: 'term-1',
            seq: 4,
            byteOffset: 12,
            byteLength: 3,
            encoding: 'base64',
            data: 'AAH/',
        });

        expect(mapped.bytes).toEqual(new Uint8Array([0, 1, 255]));
        expect(mapped.byteOffset).toBe(12);
        expect(mapped.seq).toBe(4);
    });

    it('rejects base64 byte frames whose decoded length does not match byteLength', () => {
        expect(() => mapTerminalBytesFrame({
            t: 'bytes',
            terminalId: 'term-1',
            seq: 4,
            byteOffset: 12,
            byteLength: 4,
            encoding: 'base64',
            data: 'AAH/',
        })).toThrow(/byteLength/i);
    });
});
