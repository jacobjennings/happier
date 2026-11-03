import { describe, expect, it, vi } from 'vitest';

import type { BrowserIrohStream } from './endpointClient';
import { BROWSER_IROH_STREAM_CHUNK_BYTES } from './protocol';
import {
    BROWSER_IROH_HTTP_MAX_REQUEST_HEAD_BYTES,
    BrowserIrohHttpError,
    createBrowserIrohHttpConnectionRequester,
    createBrowserIrohHomeHttpRequester,
    type BrowserIrohHomeHttpRequester,
} from './homeTunnelHttp';

const HOME_ENDPOINT_ID = 'endpoint-home';
const TEXT = new TextDecoder();

type StreamCall = 'read' | 'write' | 'finishWrite' | 'cancel' | 'close';

/**
 * The one system boundary this owner has: the worker/wasm stream handle. It is
 * faked byte-for-byte (queued response bytes in, recorded request bytes out) so
 * every framing, cancellation, and cleanup rule below is exercised against real
 * HTTP/1.1 bytes rather than against a mocked parser.
 */
function createFakeHomeStream(
    options: Readonly<{ remoteEndpointId?: string }> = {},
): Readonly<{
    stream: BrowserIrohStream;
    push: (payload: string | Uint8Array) => void;
    end: () => void;
    writtenText: () => string;
    writtenBytes: () => Uint8Array;
    hasPendingRead: () => boolean;
    countOf: (call: StreamCall) => number;
}> {
    const queued: Uint8Array[] = [];
    const written: Uint8Array[] = [];
    const calls: StreamCall[] = [];
    let ended = false;
    let pendingRead: Readonly<{ maxBytes: number; resolve: (value: Readonly<{ bytes: Uint8Array; done: boolean }>) => void }> | null = null;

    function deliverPendingRead(): void {
        if (pendingRead === null) return;
        const { resolve, maxBytes } = pendingRead;
        const next = queued.shift();
        if (next !== undefined) {
            pendingRead = null;
            if (next.byteLength > maxBytes) queued.unshift(next.subarray(maxBytes));
            resolve({ bytes: next.subarray(0, maxBytes), done: false });
            return;
        }
        if (ended) {
            pendingRead = null;
            resolve({ bytes: new Uint8Array(), done: true });
        }
    }

    const stream: BrowserIrohStream = {
        streamId: 'stream-1',
        remoteEndpointId: options.remoteEndpointId ?? HOME_ENDPOINT_ID,
        observedPath: 'relay',
        read: async (maxBytes) => {
            calls.push('read');
            const next = queued[0];
            if (next !== undefined) {
                if (next.byteLength > maxBytes) {
                    queued[0] = next.subarray(maxBytes);
                    return { bytes: next.subarray(0, maxBytes), done: false };
                }
                queued.shift();
                return { bytes: next, done: false };
            }
            if (ended) return { bytes: new Uint8Array(), done: true };
            return await new Promise((resolve) => {
                pendingRead = { maxBytes, resolve };
            });
        },
        write: async (bytes) => {
            calls.push('write');
            written.push(bytes.slice());
        },
        finishWrite: async () => {
            calls.push('finishWrite');
        },
        cancel: async () => {
            calls.push('cancel');
        },
        close: async () => {
            calls.push('close');
        },
    };

    const writtenBytes = (): Uint8Array => {
        const bytes = new Uint8Array(written.reduce((length, chunk) => length + chunk.byteLength, 0));
        let offset = 0;
        for (const chunk of written) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return bytes;
    };

    return {
        stream,
        push: (payload) => {
            queued.push(typeof payload === 'string' ? new TextEncoder().encode(payload) : payload);
            deliverPendingRead();
        },
        end: () => {
            ended = true;
            deliverPendingRead();
        },
        writtenText: () => TEXT.decode(writtenBytes()),
        writtenBytes,
        hasPendingRead: () => pendingRead !== null,
        countOf: (call) => calls.filter((entry) => entry === call).length,
    };
}

function requesterFor(
    fake: ReturnType<typeof createFakeHomeStream>,
    expectedRemoteEndpointId: string = HOME_ENDPOINT_ID,
): BrowserIrohHomeHttpRequester {
    return createBrowserIrohHomeHttpRequester({
        openStream: async () => fake.stream,
        expectedRemoteEndpointId,
    });
}

async function expectHttpErrorCode(pending: Promise<unknown>, code: string): Promise<void> {
    await expect(pending).rejects.toBeInstanceOf(BrowserIrohHttpError);
    await pending.catch((error: unknown) => {
        expect((error as BrowserIrohHttpError).code).toBe(code);
    });
}

describe('sync/runtime/browserIroh/homeTunnelHttp', () => {
    it('allows a request head at the actual single-write boundary beyond the retired quota', async () => {
        const baseline = createFakeHomeStream();
        baseline.push('HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n');
        const { response: baselineResponse } = await requesterFor(baseline)('https://home.example.test/v1/a', {
            headers: { 'x-context': 'a' },
        });
        await baselineResponse.text();

        const fake = createFakeHomeStream();
        const context = 'a'.repeat(BROWSER_IROH_HTTP_MAX_REQUEST_HEAD_BYTES - baseline.writtenBytes().byteLength + 1);
        fake.push('HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n');
        const { response } = await requesterFor(fake)('https://home.example.test/v1/a', {
            headers: { 'x-context': context },
        });
        await expect(response.text()).resolves.toBe('');
        expect(fake.writtenBytes().byteLength).toBe(BROWSER_IROH_HTTP_MAX_REQUEST_HEAD_BYTES);
        expect(fake.writtenText()).toContain(context);
    });

    it('rejects request heads that cannot fit the actual single-write budget before writing', async () => {
        const fake = createFakeHomeStream();
        await expectHttpErrorCode(requesterFor(fake)('https://home.example.test/v1/a', {
            headers: { 'x-context': 'a'.repeat(BROWSER_IROH_HTTP_MAX_REQUEST_HEAD_BYTES) },
        }), 'head_too_large');
        expect(fake.countOf('write')).toBe(0);
    });

    it('accepts a response head larger than one worker payload across bounded reads', async () => {
        const fake = createFakeHomeStream();
        const prefix = 'HTTP/1.1 200 OK\r\ncontent-length: 2\r\nx-context: ';
        const suffix = '\r\n\r\n';
        const context = 'a'.repeat(BROWSER_IROH_STREAM_CHUNK_BYTES * 2 - prefix.length - suffix.length);
        const pending = requesterFor(fake)('https://home.example.test/v1/a');
        fake.push(`${prefix}${context}${suffix}ok`);
        const { response } = await pending;
        expect(response.headers.get('x-context')).toBe(context);
        await expect(response.text()).resolves.toBe('ok');
        expect(fake.countOf('cancel')).toBe(0);
    });

    it('accepts a near-boundary head whose terminator arrives separately', async () => {
        const fake = createFakeHomeStream();
        const prefix = 'HTTP/1.1 200 OK\r\ncontent-length: 0\r\nx-context: ';
        const context = 'a'.repeat(BROWSER_IROH_STREAM_CHUNK_BYTES - prefix.length - 4);
        const pending = requesterFor(fake)('https://home.example.test/v1/a');
        fake.push(`${prefix}${context}\r\n\r`);
        await vi.waitFor(() => expect(fake.hasPendingRead()).toBe(true));
        fake.push('\n');
        const { response } = await pending;
        expect(response.headers.get('x-context')).toBe(context);
        await expect(response.text()).resolves.toBe('');
        expect(fake.countOf('cancel')).toBe(0);
    });

    it('consumes a trailer section larger than one worker payload across bounded reads', async () => {
        const fake = createFakeHomeStream();
        const pending = requesterFor(fake)('https://home.example.test/v1/a');
        fake.push('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n0\r\n');
        const { response } = await pending;
        const body = response.text();
        fake.push(`x-context: ${'a'.repeat(BROWSER_IROH_STREAM_CHUNK_BYTES)}\r\n\r\n`);
        await expect(body).resolves.toBe('');
        expect(fake.countOf('cancel')).toBe(0);
        expect(fake.countOf('close')).toBe(1);
    });

    it('passes the request signal to a pending Home stream open', async () => {
        const controller = new AbortController();
        let receivedSignal: AbortSignal | undefined;
        const requester = createBrowserIrohHomeHttpRequester({
            expectedRemoteEndpointId: HOME_ENDPOINT_ID,
            openStream: async (signal) => {
                receivedSignal = signal;
                return await new Promise((_resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
                });
            },
        });
        const pending = requester('https://home.example.test/v1/slow-open', { signal: controller.signal });
        await vi.waitFor(() => expect(receivedSignal).toBeDefined());

        controller.abort(new Error('cancel Home open'));
        expect(receivedSignal?.aborted).toBe(true);
        await expect(pending).rejects.toThrow('cancel Home open');
    });

    it('serializes reusable HTTP requests on one caller-owned stream until explicit close', async () => {
        const fake = createFakeHomeStream();
        const connection = createBrowserIrohHttpConnectionRequester({
            stream: fake.stream,
            expectedRemoteEndpointId: HOME_ENDPOINT_ID,
        });

        const firstPending = connection.request('https://machine.invalid/transfers/open', { method: 'POST' });
        fake.push('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}');
        const first = await firstPending;
        const secondPending = connection.request('https://machine.invalid/transfers/chunks/0');
        await Promise.resolve();
        expect(fake.writtenText()).not.toContain('GET /transfers/chunks/0');
        await expect(first.text()).resolves.toBe('{}');
        await vi.waitFor(() => {
            expect(fake.writtenText()).toContain('GET /transfers/chunks/0');
        });
        fake.push('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n2\r\nok\r\n0\r\n\r\n');
        const second = await secondPending;
        await expect(second.text()).resolves.toBe('ok');
        await connection.close();

        const wire = fake.writtenText();
        expect(wire).toContain('POST /transfers/open HTTP/1.1\r\n');
        expect(wire).toContain('GET /transfers/chunks/0 HTTP/1.1\r\n');
        expect(wire.match(/connection: keep-alive\r\n/gu)).toHaveLength(2);
        expect(fake.countOf('finishWrite')).toBe(1);
        expect(fake.countOf('close')).toBe(1);
        expect(fake.countOf('cancel')).toBe(0);
    });

    it.each([
        ['empty', 'HTTP/1.1 204 No Content\r\n\r\n'],
        ['content-length', 'HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}'],
        ['chunked', 'HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n2\r\nok\r\n0\r\n\r\n'],
    ])('rejects buffered response surplus after a completed %s response', async (_framing, firstResponse) => {
        const fake = createFakeHomeStream();
        const connection = createBrowserIrohHttpConnectionRequester({
            stream: fake.stream,
            expectedRemoteEndpointId: HOME_ENDPOINT_ID,
        });
        const pending = connection.request('https://machine.invalid/transfers/open', { method: 'POST' });
        fake.push(`${firstResponse}HTTP/1.1 200 OK\r\ncontent-length: 6\r\n\r\nsecond`);

        if (_framing === 'empty') {
            await expectHttpErrorCode(pending, 'connection_not_reusable');
        } else {
            const response = await pending;
            await expectHttpErrorCode(response.text(), 'connection_not_reusable');
        }
        await expect(connection.request('https://machine.invalid/transfers/chunks/0'))
            .rejects.toMatchObject({ code: 'connection_not_reusable' });
        expect(fake.countOf('cancel')).toBe(1);
        expect(fake.countOf('close')).toBe(1);
    });

    it('fails a caller-owned connection closed when a response cannot be reused', async () => {
        const fake = createFakeHomeStream();
        const connection = createBrowserIrohHttpConnectionRequester({
            stream: fake.stream,
            expectedRemoteEndpointId: HOME_ENDPOINT_ID,
        });
        const pending = connection.request('https://machine.invalid/transfers/open');
        fake.push('HTTP/1.1 200 OK\r\n\r\nbody-until-close');

        await expectHttpErrorCode(pending, 'connection_not_reusable');
        await expect(connection.request('https://machine.invalid/transfers/chunks/0'))
            .rejects.toMatchObject({ code: 'connection_not_reusable' });
        expect(fake.countOf('cancel')).toBe(1);
        expect(fake.countOf('close')).toBe(1);
    });

    it('carries an authenticated JSON GET and preserves the proven remote EndpointId', async () => {
        const fake = createFakeHomeStream();
        const pending = requesterFor(fake)(
            'https://home.example.test/v1/account/me?scope=full#fragment',
            { headers: { authorization: 'Bearer token-1', accept: 'application/json' } },
        );
        await vi.waitFor(() => {
            expect(fake.hasPendingRead()).toBe(true);
        });

        // HTTP framing, not a transport FIN, delimits the request. Keeping the
        // write side open is required for ordinary Home HTTP servers to send a
        // response after asynchronous route work.
        expect(fake.writtenText().endsWith('\r\n\r\n')).toBe(true);
        expect(fake.countOf('finishWrite')).toBe(0);
        fake.push(
            'HTTP/1.1 200 OK\r\n'
            + 'content-type: application/json\r\n'
            + 'content-length: 17\r\n'
            + '\r\n'
            + '{"account":"a-1"}',
        );

        const result = await pending;
        const head = fake.writtenText();

        expect(head.startsWith('GET /v1/account/me?scope=full HTTP/1.1\r\n')).toBe(true);
        expect(head).toContain('host: home.example.test\r\n');
        expect(head).toContain('authorization: Bearer token-1\r\n');
        expect(head).toContain('accept: application/json\r\n');
        expect(head.endsWith('\r\n\r\n')).toBe(true);
        // A fragment is request-URL state the wire never carries.
        expect(head).not.toContain('fragment');
        expect(head).not.toContain('transfer-encoding');

        expect(result.remoteEndpointId).toBe(HOME_ENDPOINT_ID);
        expect(result.response.status).toBe(200);
        expect(result.response.headers.get('content-type')).toBe('application/json');
        await expect(result.response.json()).resolves.toEqual({ account: 'a-1' });

        expect(fake.countOf('finishWrite')).toBe(0);
        expect(fake.countOf('close')).toBe(1);
        expect(fake.countOf('cancel')).toBe(0);
    });

    it('treats a browser-provided undefined Request body as an empty body', async () => {
        const bodyGetter = vi.spyOn(Request.prototype, 'body', 'get')
            .mockReturnValue(undefined as never);
        try {
            const fake = createFakeHomeStream();
            const pending = requesterFor(fake)('https://home.example.test/v1/sessions');
            fake.push('HTTP/1.1 204 No Content\r\ncontent-length: 0\r\n\r\n');

            await expect(pending).resolves.toMatchObject({ response: { status: 204 } });
            expect(fake.writtenText()).toContain('GET /v1/sessions HTTP/1.1\r\n');
            expect(fake.writtenText()).not.toContain('transfer-encoding');
            expect(fake.countOf('cancel')).toBe(0);
        } finally {
            bodyGetter.mockRestore();
        }
    });

    it('preserves a browser-provided request body when its stream property is unavailable', async () => {
        const NativeRequest = Request;
        class RequestWithoutBodyStream {
            readonly url: string;
            readonly method: string;
            readonly headers: Headers;
            readonly signal: AbortSignal;
            readonly body = undefined;
            private readonly bytes: Uint8Array;

            constructor(input: RequestInfo | URL, init?: RequestInit) {
                this.url = String(input);
                this.method = init?.method ?? 'GET';
                this.headers = new Headers(init?.headers);
                this.signal = init?.signal ?? new AbortController().signal;
                this.bytes = new TextEncoder().encode(String(init?.body ?? ''));
            }

            async arrayBuffer() { return this.bytes.slice().buffer; }
        }
        vi.stubGlobal('Request', RequestWithoutBodyStream as unknown as typeof Request);
        try {
            const fake = createFakeHomeStream();
            const connection = createBrowserIrohHttpConnectionRequester({
                stream: fake.stream,
                expectedRemoteEndpointId: HOME_ENDPOINT_ID,
            });
            const pending = connection.request('https://machine.invalid/v1/grants', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{"flow":"finite_transfer"}',
            });
            await vi.waitFor(() => {
                expect(fake.writtenText()).toContain('1a\r\n{"flow":"finite_transfer"}\r\n0\r\n\r\n');
            });
            fake.push('HTTP/1.1 201 Created\r\ncontent-length: 0\r\n\r\n');

            const response = await pending;
            expect(response.status).toBe(201);
            await expect(response.arrayBuffer()).resolves.toHaveProperty('byteLength', 0);
            expect(fake.writtenText()).toContain('transfer-encoding: chunked\r\n');
            expect(fake.writtenText()).toContain('1a\r\n{"flow":"finite_transfer"}\r\n0\r\n\r\n');
            await connection.close();
            expect(fake.countOf('cancel')).toBe(0);
        } finally {
            vi.stubGlobal('Request', NativeRequest);
        }
    });

    it('streams a request body incrementally as chunked framing it owns', async () => {
        const fake = createFakeHomeStream();
        const pending = requesterFor(fake)('https://home.example.test/v1/sessions', {
            method: 'POST',
            body: '{"a":1}',
            headers: { 'content-type': 'application/json', 'content-length': '999' },
        });
        fake.push('HTTP/1.1 201 Created\r\ncontent-length: 0\r\n\r\n');

        const result = await pending;
        const wire = fake.writtenText();

        expect(wire.startsWith('POST /v1/sessions HTTP/1.1\r\n')).toBe(true);
        expect(wire).toContain('transfer-encoding: chunked\r\n');
        // The carrier owns framing: a caller-supplied length is never trusted
        // alongside it, because that is exactly the smuggling shape.
        expect(wire).not.toContain('content-length: 999');
        expect(wire.endsWith('\r\n\r\n7\r\n{"a":1}\r\n0\r\n\r\n')).toBe(true);
        expect(result.response.status).toBe(201);
        expect(fake.countOf('finishWrite')).toBe(0);
    });

    it('cancels the request body reader on a stream write failure without masking that failure', async () => {
        const fake = createFakeHomeStream();
        const primary = new Error('primary stream write failure');
        const sourceCancel = vi.fn(async () => {
            throw new Error('secondary source cancellation failure');
        });
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
            },
            cancel: sourceCancel,
        });
        let writes = 0;
        const stream: BrowserIrohStream = {
            ...fake.stream,
            write: async (bytes) => {
                writes += 1;
                if (writes === 2) throw primary;
                await fake.stream.write(bytes);
            },
        };
        const requester = createBrowserIrohHomeHttpRequester({
            openStream: async () => stream,
            expectedRemoteEndpointId: HOME_ENDPOINT_ID,
        });

        const pending = requester('https://home.example.test/v1/sessions', {
            method: 'POST',
            body,
            duplex: 'half',
        } as RequestInit & { duplex: 'half' });

        await expect(pending).rejects.toBe(primary);
        expect(sourceCancel).toHaveBeenCalledTimes(1);
        expect(sourceCancel).toHaveBeenCalledWith(primary);
    });

    it('cancels a pending request body reader on abort but only releases it after EOF', async () => {
        const fake = createFakeHomeStream();
        const abortController = new AbortController();
        const abortReason = new Error('body upload aborted');
        const abortedSourceCancel = vi.fn(async () => undefined);
        const pendingBody = new ReadableStream<Uint8Array>({
            pull: async () => await new Promise<void>(() => {}),
            cancel: abortedSourceCancel,
        });
        const requester = requesterFor(fake);
        const pending = requester('https://home.example.test/v1/upload', {
            method: 'POST',
            body: pendingBody,
            duplex: 'half',
            signal: abortController.signal,
        } as RequestInit & { duplex: 'half' });
        abortController.abort(abortReason);

        await expect(pending).rejects.toBe(abortReason);
        await vi.waitFor(() => expect(abortedSourceCancel).toHaveBeenCalledWith(abortReason));

        const eofSourceCancel = vi.fn(async () => undefined);
        const eofBody = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([4]));
                controller.close();
            },
            cancel: eofSourceCancel,
        });
        const eofFake = createFakeHomeStream();
        const completed = requesterFor(eofFake)('https://home.example.test/v1/upload', {
            method: 'POST', body: eofBody, duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        eofFake.push('HTTP/1.1 204 No Content\r\ncontent-length: 0\r\n\r\n');
        await expect(completed).resolves.toMatchObject({ response: { status: 204 } });
        expect(eofSourceCancel).not.toHaveBeenCalled();
    });

    it('delivers the response body incrementally and only reads when the consumer pulls', async () => {
        const fake = createFakeHomeStream();
        const pending = requesterFor(fake)('https://home.example.test/v1/stream');
        fake.push('HTTP/1.1 200 OK\r\ncontent-length: 10\r\n\r\n');

        const { response } = await pending;
        const body = response.body;
        if (body === null) throw new Error('expected a streaming response body');
        expect(fake.countOf('read')).toBe(1);

        const reader = body.getReader();
        fake.push('abcde');
        const first = await reader.read();
        expect(TEXT.decode(first.value)).toBe('abcde');
        expect(fake.countOf('read')).toBe(2);
        expect(fake.countOf('close')).toBe(0);

        fake.push('fghij');
        const second = await reader.read();
        expect(TEXT.decode(second.value)).toBe('fghij');
        const end = await reader.read();
        expect(end.done).toBe(true);
        expect(fake.countOf('close')).toBe(1);
    });

    it('decodes a chunked response through its trailer termination', async () => {
        const fake = createFakeHomeStream();
        const pending = requesterFor(fake)('https://home.example.test/v1/chunked');
        fake.push('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n');
        fake.push('4\r\nWiki\r\n5;name=value\r\npedia\r\n0\r\nx-trailer: t\r\n\r\n');

        const { response } = await pending;
        await expect(response.text()).resolves.toBe('Wikipedia');
        // The decoded response no longer carries the hop-by-hop coding.
        expect(response.headers.get('transfer-encoding')).toBeNull();
        expect(fake.countOf('close')).toBe(1);
    });

    it('treats HEAD and no-body statuses as bodiless without reading a body', async () => {
        const headFake = createFakeHomeStream();
        const headPending = requesterFor(headFake)('https://home.example.test/v1/big', {
            method: 'HEAD',
        });
        headFake.push('HTTP/1.1 200 OK\r\ncontent-length: 4242\r\n\r\n');
        const headResult = await headPending;
        expect(headResult.response.status).toBe(200);
        expect(headResult.response.headers.get('content-length')).toBe('4242');
        await expect(headResult.response.text()).resolves.toBe('');
        expect(headFake.countOf('read')).toBe(1);
        expect(headFake.countOf('close')).toBe(1);

        const emptyFake = createFakeHomeStream();
        const emptyPending = requesterFor(emptyFake)('https://home.example.test/v1/thing', {
            method: 'DELETE',
        });
        emptyFake.push('HTTP/1.1 204 No Content\r\n\r\n');
        const emptyResult = await emptyPending;
        expect(emptyResult.response.status).toBe(204);
        expect(emptyResult.response.body).toBeNull();
        expect(emptyFake.countOf('close')).toBe(1);
    });

    it('rejects smuggled and malformed response framing with typed errors', async () => {
        const conflicting = createFakeHomeStream();
        const conflictingPending = requesterFor(conflicting)('https://home.example.test/v1/a');
        conflicting.push(
            'HTTP/1.1 200 OK\r\ncontent-length: 5\r\ntransfer-encoding: chunked\r\n\r\nhello',
        );
        await expectHttpErrorCode(conflictingPending, 'conflicting_framing');
        expect(conflicting.countOf('cancel')).toBe(1);

        const duplicateLength = createFakeHomeStream();
        const duplicatePending = requesterFor(duplicateLength)('https://home.example.test/v1/a');
        duplicateLength.push('HTTP/1.1 200 OK\r\ncontent-length: 5\r\ncontent-length: 7\r\n\r\nhello');
        await expectHttpErrorCode(duplicatePending, 'conflicting_framing');

        const coding = createFakeHomeStream();
        const codingPending = requesterFor(coding)('https://home.example.test/v1/a');
        coding.push('HTTP/1.1 200 OK\r\ntransfer-encoding: gzip\r\n\r\n');
        await expectHttpErrorCode(codingPending, 'unsupported_transfer_coding');

        const statusLine = createFakeHomeStream();
        const statusPending = requesterFor(statusLine)('https://home.example.test/v1/a');
        statusLine.push('ICY 200 OK\r\n\r\n');
        await expectHttpErrorCode(statusPending, 'malformed_response');

        const headerLine = createFakeHomeStream();
        const headerPending = requesterFor(headerLine)('https://home.example.test/v1/a');
        headerLine.push('HTTP/1.1 200 OK\r\nx-bad name: 1\r\n\r\n');
        await expectHttpErrorCode(headerPending, 'malformed_response');

        const chunkSize = createFakeHomeStream();
        const chunkPending = requesterFor(chunkSize)('https://home.example.test/v1/a');
        chunkSize.push('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\nzz\r\nnope\r\n');
        const chunked = await chunkPending;
        await expectHttpErrorCode(chunked.response.text(), 'malformed_response');
        expect(chunkSize.countOf('cancel')).toBe(1);

        const chunkTerminator = createFakeHomeStream();
        const terminatorPending = requesterFor(chunkTerminator)('https://home.example.test/v1/a');
        chunkTerminator.push('HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n4\r\nWikiXX\r\n0\r\n\r\n');
        const terminated = await terminatorPending;
        await expectHttpErrorCode(terminated.response.text(), 'malformed_response');

        const truncated = createFakeHomeStream();
        const truncatedPending = requesterFor(truncated)('https://home.example.test/v1/a');
        truncated.push('HTTP/1.1 200 OK\r\ncontent-length: 10\r\n\r\nabc');
        truncated.end();
        const truncatedResult = await truncatedPending;
        await expectHttpErrorCode(truncatedResult.response.text(), 'truncated_response');
        expect(truncated.countOf('cancel')).toBe(1);
    });

    it('reports a truncated large response head when the stream ends before its delimiter', async () => {
        const fake = createFakeHomeStream();
        const pending = requesterFor(fake)('https://home.example.test/v1/a');
        fake.push('HTTP/1.1 200 OK\r\n');
        fake.push(`x-huge: ${'a'.repeat(BROWSER_IROH_HTTP_MAX_REQUEST_HEAD_BYTES)}\r\n`);
        fake.end();
        await expectHttpErrorCode(pending, 'truncated_response');
        expect(fake.countOf('cancel')).toBe(1);
    });

    it('cancels promptly on abort and lets no late byte change the outcome', async () => {
        const fake = createFakeHomeStream();
        const controller = new AbortController();
        const pending = requesterFor(fake)('https://home.example.test/v1/slow', {
            signal: controller.signal,
        });
        await vi.waitFor(() => {
            expect(fake.hasPendingRead()).toBe(true);
        });

        controller.abort();
        await expect(pending).rejects.toThrow();
        expect(fake.countOf('cancel')).toBe(1);
        expect(fake.countOf('close')).toBe(1);

        // The held read now answers. It must not resurrect a response.
        fake.push('HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n');
        fake.end();
        // Flush a macrotask so a cleanup that fires a tick late is still caught.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(fake.countOf('cancel')).toBe(1);
        expect(fake.countOf('close')).toBe(1);
    });

    it('writes nothing to a stream whose proven EndpointId is not the requested one', async () => {
        const fake = createFakeHomeStream({ remoteEndpointId: 'endpoint-impostor' });
        const pending = requesterFor(fake, HOME_ENDPOINT_ID)(
            'https://home.example.test/v1/account/me',
            { headers: { authorization: 'Bearer token-1' } },
        );

        await expectHttpErrorCode(pending, 'endpoint_identity_mismatch');
        expect(fake.writtenBytes().byteLength).toBe(0);
        expect(fake.countOf('finishWrite')).toBe(0);
        expect(fake.countOf('cancel')).toBe(1);
        expect(fake.countOf('close')).toBe(1);
    });

    it('cleans up exactly once however many times cleanup is asked for', async () => {
        const fake = createFakeHomeStream();
        const controller = new AbortController();
        const pending = requesterFor(fake)('https://home.example.test/v1/stream', {
            signal: controller.signal,
        });
        fake.push('HTTP/1.1 200 OK\r\ncontent-length: 10\r\n\r\nabcde');

        const { response } = await pending;
        const body = response.body;
        if (body === null) throw new Error('expected a streaming response body');
        const reader = body.getReader();
        await reader.read();

        await reader.cancel();
        await reader.cancel();
        controller.abort();
        await Promise.resolve();

        expect(fake.countOf('cancel')).toBe(1);
        expect(fake.countOf('close')).toBe(1);
    });

    it('fails closed on a request the Fetch primitives refuse to represent', async () => {
        const fake = createFakeHomeStream();
        let opened = 0;
        const requester = createBrowserIrohHomeHttpRequester({
            openStream: async () => {
                opened += 1;
                return fake.stream;
            },
            expectedRemoteEndpointId: HOME_ENDPOINT_ID,
        });

        // Userinfo credentials must never reach a Home stream.
        await expectHttpErrorCode(
            requester('https://user:secret@home.example.test/v1/a'),
            'invalid_request',
        );
        await expectHttpErrorCode(
            requester('ws://home.example.test/v1/a'),
            'invalid_request',
        );
        expect(opened).toBe(0);
    });
});
