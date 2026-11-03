import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { Terminal } from '@xterm/xterm';

const assets = vi.hoisted(() => ({ bundle: '', css: '' }));

// The generated bundle is a build artifact; tests choose its contents per case.
vi.mock('./xtermWebViewAssets.generated', () => ({
    get XTERM_WEBVIEW_BUNDLE_JS() { return assets.bundle; },
    get XTERM_WEBVIEW_CSS() { return assets.css; },
}));

import { buildXtermWebViewHtml } from './xtermWebViewHtml';

function buildHtml(overrides: Partial<Parameters<typeof buildXtermWebViewHtml>[0]> = {}): string {
    return buildXtermWebViewHtml({
        theme: { backgroundColor: '#000', textColor: '#fff', cursorColor: '#fff', selectionBackgroundColor: '#222', isDark: true },
        fontSizePx: 14,
        lineHeightPx: 18,
        maxChunkBytes: 64_000,
        allowCdnFallback: false,
        ...overrides,
    });
}

type GuestMessage = Readonly<{ v: number; type: string; payload: unknown }>;
type GuestListener = (event: unknown) => void;
type GuestKeyHandler = (event: KeyboardEvent) => boolean;

function guestEvent(fields: Record<string, unknown> = {}) {
    return { preventDefault: vi.fn(), stopPropagation: vi.fn(), ...fields };
}

function keydown(fields: Readonly<{ key: string; ctrlKey?: boolean; metaKey?: boolean; defaultPrevented?: boolean }>) {
    const event = guestEvent({
        type: 'keydown',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: false,
        repeat: false,
        defaultPrevented: false,
        ...fields,
    });
    // The guest reads only these KeyboardEvent fields; this fixture stands in for the WebView DOM event.
    return { event, keyboardEvent: event as unknown as KeyboardEvent };
}

/**
 * Boots the real guest page script in node:vm. Only the WebView DOM/layout boundary, the WebView timers and the
 * xterm addons are replaced; the real xterm parser handles every write.
 */
async function bootXtermWebViewGuest() {
    const script = buildHtml().match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('WebView module script missing');
    const messages: GuestMessage[] = [];
    const rootListeners = new Map<string, GuestListener[]>();
    const windowListeners = new Map<string, GuestListener[]>();
    const addListener = (listeners: Map<string, GuestListener[]>) => (name: string, listener: GuestListener) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    };
    const dispatch = (listeners: Map<string, GuestListener[]>, name: string, event: unknown) => {
        for (const listener of listeners.get(name) ?? []) listener(event);
    };

    let clock = 0;
    let nextTimerId = 1;
    const timers = new Map<number, { at: number; run: () => void }>();
    const advance = (ms: number) => {
        const until = clock + ms;
        for (;;) {
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.at <= until)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!due) break;
            timers.delete(due[0]);
            clock = due[1].at;
            due[1].run();
        }
        clock = until;
    };

    const layout = { width: 800, height: 600, cols: 80, rows: 24 };
    const parsed: Array<Promise<void>> = [];
    const writes: Array<string | Uint8Array> = [];
    const sentinel = { osc52: 0, dcsQ: 0, controlOsc: 0, controlDcs: 0 };
    let focusCount = 0;
    let fitCount = 0;
    let selection = '';
    let keyHandler: GuestKeyHandler | null = null;
    let linkHandler: ((event: unknown, uri: string) => void) | null = null;
    let resizeObserverCallback: (() => void) | null = null;
    let terminal: Terminal | null = null;

    class ParserTerminal extends Terminal {
        constructor(options: ConstructorParameters<typeof Terminal>[0]) {
            super(options);
            terminal = this;
            // Registered before the guest's handlers: it only runs when the guest leaves the sequence unconsumed.
            this.parser.registerOscHandler(52, () => { sentinel.osc52 += 1; return true; });
            this.parser.registerDcsHandler({ final: 'q' }, () => { sentinel.dcsQ += 1; return true; });
            // Controls: sequences the guest does not claim must reach these, proving the sentinels observe the parser.
            this.parser.registerOscHandler(7777, () => { sentinel.controlOsc += 1; return true; });
            this.parser.registerDcsHandler({ final: 'p' }, () => { sentinel.controlDcs += 1; return true; });
        }
        open() {}
        focus() { focusCount += 1; }
        hasSelection() { return selection.length > 0; }
        getSelection() { return selection; }
        attachCustomKeyEventHandler(handler: GuestKeyHandler) {
            keyHandler = handler;
            super.attachCustomKeyEventHandler(handler);
        }
        write(data: string | Uint8Array, callback?: () => void) {
            writes.push(data);
            parsed.push(new Promise<void>((resolve) => super.write(data, () => {
                callback?.();
                resolve();
            })));
        }
    }
    class FitAddonStub {
        private term: Terminal | null = null;
        activate(term: Terminal) { this.term = term; }
        fit() {
            fitCount += 1;
            if (this.term && (this.term.cols !== layout.cols || this.term.rows !== layout.rows)) {
                this.term.resize(layout.cols, layout.rows);
            }
        }
        dispose() {}
    }
    class WebLinksAddonStub {
        constructor(handler?: (event: unknown, uri: string) => void) { linkHandler = handler ?? null; }
        activate() {}
        dispose() {}
    }
    class ResizeObserverStub {
        constructor(callback: () => void) { resizeObserverCallback = callback; }
        observe() {}
        disconnect() {}
    }
    const root = {
        addEventListener: addListener(rootListeners),
        getBoundingClientRect: () => ({ width: layout.width, height: layout.height }),
    };

    runInNewContext(script, {
        HAPPIER_XTERM_WEBVIEW: { Terminal: ParserTerminal, FitAddon: FitAddonStub, WebLinksAddon: WebLinksAddonStub },
        window: {
            ReactNativeWebView: { postMessage: (message: string) => messages.push(JSON.parse(message)) },
            addEventListener: addListener(windowListeners),
        },
        document: { getElementById: () => root, addEventListener: () => {} },
        ResizeObserver: ResizeObserverStub,
        TextEncoder, TextDecoder, Uint8Array, atob, btoa,
        setTimeout: (run: () => void, delayMs = 0) => {
            const id = nextTimerId++;
            timers.set(id, { at: clock + Number(delayMs), run });
            return id;
        },
        clearTimeout: (id: number) => { timers.delete(id); },
    });
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    const booted = terminal as Terminal | null;
    if (!booted) throw new Error('WebView terminal not booted');

    return {
        terminal: booted,
        layout,
        writes,
        sentinel,
        advance,
        pendingTimers: () => timers.size,
        focusCount: () => focusCount,
        fitCount: () => fitCount,
        setSelection: (text: string) => { selection = text; },
        keyHandler: () => keyHandler,
        linkHandler: () => linkHandler,
        triggerResizeObserver: () => resizeObserverCallback?.(),
        ofType: (type: string) => messages.filter((message) => message.type === type),
        dispatchRoot: (name: string, event: unknown) => dispatch(rootListeners, name, event),
        dispatchWindow: (name: string, event: unknown) => dispatch(windowListeners, name, event),
        send: (type: string, payload: unknown) => dispatch(windowListeners, 'message', { data: JSON.stringify({ v: 1, type, payload }) }),
        flushParser: () => Promise.all(parsed),
    };
}

describe('buildXtermWebViewHtml', () => {
    beforeEach(() => {
        assets.bundle = '';
        assets.css = '';
    });

    it('suppresses real parser DA replies during replay until completion and resumes live input', async () => {
        const html = buildHtml();
        const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
        if (!script) throw new Error('WebView module script missing');
        const messages: Array<{ type: string; payload: unknown }> = [];
        const listeners = new Map<string, (event: { data: string }) => void>();
        const parsed: Array<Promise<void>> = [];
        const completions: Array<() => void> = [];
        let terminal: Terminal | null = null;
        // Only the WebView DOM/layout boundary is replaced; xterm parses every byte.
        class ParserTerminal extends Terminal {
            constructor(options: ConstructorParameters<typeof Terminal>[0]) { super(options); terminal = this; }
            open() {}
            focus() {}
            write(data: string | Uint8Array, callback?: () => void) {
                parsed.push(new Promise<void>((resolve) => super.write(data, () => {
                    if (callback) completions.push(callback);
                    resolve();
                })));
            }
        }
        const root = { addEventListener: () => {} };
        const sandbox = {
            HAPPIER_XTERM_WEBVIEW: { Terminal: ParserTerminal, FitAddon: class { activate() {} fit() {} dispose() {} } },
            window: {
                ReactNativeWebView: { postMessage: (message: string) => messages.push(JSON.parse(message)) },
                addEventListener: (name: string, listener: (event: { data: string }) => void) => listeners.set(name, listener),
            },
            document: { getElementById: () => root, addEventListener: () => {} },
            TextEncoder, TextDecoder, Uint8Array, atob, btoa,
            setTimeout: () => 1, clearTimeout: () => {},
        };
        runInNewContext(script, sandbox);
        await Promise.resolve();
        await Promise.resolve();
        const send = (data: string, intent?: 'replay') => {
            const listener = listeners.get('message');
            if (!listener) throw new Error('WebView host message listener missing');
            listener({ data: JSON.stringify({ v: 1, type: 'write', payload: { data, intent } }) });
        };
        const activeTerminal = terminal as Terminal | null;
        if (!activeTerminal) throw new Error('WebView terminal not booted');
        try {
            // Both renderer adapters preserve the user's terminal colors without contrast rewriting.
            expect(activeTerminal.options.minimumContrastRatio).toBe(1);
            expect(activeTerminal.options.drawBoldTextInBrightColors).toBe(false);
            expect(activeTerminal.options.fontWeightBold).toBe('bold');
            send('\u001b[c', 'replay');
            await Promise.all(parsed);
            expect(messages.filter((message) => message.type === 'input')).toEqual([]);
            activeTerminal.input('during replay');
            expect(messages.filter((message) => message.type === 'input')).toEqual([]);
            completions.shift()?.();
            activeTerminal.input('after replay');
            expect(messages.filter((message) => message.type === 'input')).toEqual([
                { v: 1, type: 'input', payload: { data: 'after replay' } },
            ]);
            messages.length = 0;
            send('\u001b[c');
            await Promise.all(parsed);
            expect(messages.filter((message) => message.type === 'input')).toEqual([
                { v: 1, type: 'input', payload: { data: expect.stringMatching(/^\u001b\[\?/) } },
            ]);
            completions.shift()?.();
        } finally {
            activeTerminal.dispose();
        }
    });

    it('embeds the Xterm bundle when available and avoids CDN imports', () => {
        assets.bundle = '/* bundled-xterm */ globalThis.__XTERM__ = 1;';
        assets.css = '/* xterm-css */';

        const html = buildHtml({ allowCdnFallback: true });

        expect(html).toContain('bundled-xterm');
        expect(html).toContain('xterm-css');
        expect(html).not.toContain('cdn.jsdelivr.net');
    });

    it('falls back to CDN imports when the bundle is not available and allowCdnFallback=true', () => {
        expect(buildHtml({ allowCdnFallback: true })).toContain('cdn.jsdelivr.net');
    });

    it('enables xterm screen reader DOM mode and consumes clipboard and image control sequences inside the native WebView', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            expect(guest.terminal.options.screenReaderMode).toBe(true);

            guest.send('write', {
                data: '\u001b]52;c;aGVsbG8=\u0007\u001bP0;1q#0;2;0;0;0\u001b\\\u001b]7777;x\u0007\u001bP1p\u001b\\',
            });
            await guest.flushParser();
            expect(guest.sentinel).toEqual({ osc52: 0, dcsQ: 0, controlOsc: 1, controlDcs: 1 });
            expect(guest.ofType('input')).toEqual([]);

            guest.setSelection('selected output');
            const copy = keydown({ key: 'c', ctrlKey: true });
            expect(guest.keyHandler()?.(copy.keyboardEvent)).toBe(false);
            expect(copy.event.preventDefault).toHaveBeenCalled();
            expect(guest.ofType('copySelection')).toEqual([
                { v: 1, type: 'copySelection', payload: { text: 'selected output' } },
            ]);
        } finally {
            guest.terminal.dispose();
        }
    });

    it('never forwards a chord the WebView already handled, but keeps an unhandled Ctrl+G for the PTY', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            const handled = keydown({ key: 'g', ctrlKey: true, defaultPrevented: true });
            expect(guest.keyHandler()?.(handled.keyboardEvent)).toBe(false);

            const unhandled = keydown({ key: 'g', ctrlKey: true });
            expect(guest.keyHandler()?.(unhandled.keyboardEvent)).toBe(true);
        } finally {
            guest.terminal.dispose();
        }
    });

    it('clears retained output and refocuses xterm on host clear and focus messages', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            guest.advance(20);
            const focusesAfterReady = guest.focusCount();
            guest.send('write', { data: 'retained output' });
            await guest.flushParser();
            expect(guest.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('retained output');

            guest.send('clear', {});
            await guest.flushParser();
            expect(guest.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('');

            guest.send('focus', {});
            expect(guest.focusCount()).toBe(focusesAfterReady + 1);
        } finally {
            guest.terminal.dispose();
        }
    });

    it('focuses the xterm input from native WebView user gestures', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            guest.advance(20);
            expect(guest.focusCount()).toBe(1);

            for (const gesture of ['pointerdown', 'touchstart', 'mousedown']) {
                guest.dispatchRoot(gesture, guestEvent());
            }
            expect(guest.focusCount()).toBe(4);
        } finally {
            guest.terminal.dispose();
        }
    });

    it('captures real WebView clipboard paste before xterm emits ordinary input', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            const paste = guestEvent({
                clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'pasted text' : '') },
            });
            guest.dispatchRoot('paste', paste);

            expect(guest.ofType('paste')).toEqual([{ v: 1, type: 'paste', payload: { text: 'pasted text' } }]);
            expect(paste.preventDefault).toHaveBeenCalled();
            expect(paste.stopPropagation).toHaveBeenCalled();
            expect(guest.ofType('input')).toEqual([]);
        } finally {
            guest.terminal.dispose();
        }
    });

    it('decodes base64 byte writes before passing Uint8Array chunks into xterm', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            guest.send('writeBytes', {
                terminalId: 'native-terminal',
                seq: 3,
                byteOffset: 9,
                byteLength: 5,
                dataBase64: 'AP9Bwyg=',
                writeGeneration: 7,
            });

            expect(guest.writes).toEqual([new Uint8Array([0x00, 0xff, 0x41, 0xc3, 0x28])]);
            expect(guest.ofType('writeComplete')).toEqual([]);
            await guest.flushParser();
            expect(guest.ofType('writeComplete')).toEqual([{
                v: 1,
                type: 'writeComplete',
                payload: { terminalId: 'native-terminal', seq: 3, byteOffset: 9, byteLength: 5, ackedByteOffset: 14, writeGeneration: 7 },
            }]);
        } finally {
            guest.terminal.dispose();
        }
    });

    it('suppresses stale xterm renderer timer errors after WebView teardown', async () => {
        const guest = await bootXtermWebViewGuest();
        guest.dispatchWindow('pagehide', guestEvent());
        const disposedRendererError = {
            message: "Cannot read properties of undefined (reading 'dimensions')",
            stack: 'TypeError\n    at RenderService._renderRows (xterm.js:1:1)',
        };

        const error = guestEvent({ error: disposedRendererError });
        guest.dispatchWindow('error', error);
        const rejection = guestEvent({ reason: disposedRendererError });
        guest.dispatchWindow('unhandledrejection', rejection);
        const unrelated = guestEvent({ error: { message: 'boom', stack: 'at RenderService' } });
        guest.dispatchWindow('error', unrelated);

        expect(error.preventDefault).toHaveBeenCalled();
        expect(rejection.preventDefault).toHaveBeenCalled();
        expect(unrelated.preventDefault).not.toHaveBeenCalled();
        expect(guest.ofType('bootError')).toEqual([]);
    });

    it('retries the initial ready fit while the WebView root is still laying out', async () => {
        const guest = await bootXtermWebViewGuest();
        const neverLaidOut = await bootXtermWebViewGuest();
        try {
            guest.layout.width = 0;
            guest.layout.height = 0;
            guest.advance(20 + 50);
            expect(guest.ofType('ready')).toEqual([]);

            guest.layout.width = 800;
            guest.layout.height = 600;
            guest.advance(50);
            expect(guest.ofType('ready')).toEqual([{ v: 1, type: 'ready', payload: { cols: 80, rows: 24 } }]);
            guest.advance(5_000);
            expect(guest.ofType('ready')).toHaveLength(1);
            expect(guest.pendingTimers()).toBe(0);

            neverLaidOut.layout.width = 0;
            neverLaidOut.advance(20 + 50 * 30);
            expect(neverLaidOut.ofType('ready')).toEqual([]);
            expect(neverLaidOut.pendingTimers()).toBe(0);
        } finally {
            guest.terminal.dispose();
            neverLaidOut.terminal.dispose();
        }
    });

    it('debounces resize-triggered xterm fitting during native keyboard animations', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            guest.advance(20);
            expect(guest.ofType('ready')).toHaveLength(1);
            const fitsAfterReady = guest.fitCount();

            guest.layout.cols = 100;
            guest.layout.rows = 30;
            guest.triggerResizeObserver();
            guest.advance(60);
            guest.triggerResizeObserver();
            guest.advance(60);
            guest.dispatchWindow('resize', guestEvent());
            guest.advance(119);
            expect(guest.ofType('resize')).toEqual([]);
            expect(guest.fitCount()).toBe(fitsAfterReady);

            guest.advance(1);
            expect(guest.fitCount()).toBe(fitsAfterReady + 1);
            expect(guest.ofType('resize')).toEqual([{ v: 1, type: 'resize', payload: { cols: 100, rows: 30 } }]);
        } finally {
            guest.terminal.dispose();
        }
    });

    it('routes xterm web links to the host instead of using the addon default opener', async () => {
        const guest = await bootXtermWebViewGuest();
        try {
            const handler = guest.linkHandler();
            expect(handler).toBeTypeOf('function');
            const activation = guestEvent();
            handler?.(activation, 'https://example.com/docs');

            expect(activation.preventDefault).toHaveBeenCalled();
            expect(guest.ofType('link')).toEqual([{ v: 1, type: 'link', payload: { url: 'https://example.com/docs' } }]);
        } finally {
            guest.terminal.dispose();
        }
    });
});
