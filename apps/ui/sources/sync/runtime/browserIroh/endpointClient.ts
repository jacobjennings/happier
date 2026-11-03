/**
 * The tab side of the browser Iroh command boundary (Lane 06 amendment
 * A7.2/A7.3/A7.4).
 *
 * A tab never owns an endpoint. It holds a lease on the one endpoint the
 * SharedWorker owns, and releasing that lease — on logout, on navigation away,
 * or when this tab simply closes — leaves every sibling tab untouched. Ordinary
 * page end is covered best-effort by `pageLifecycleRelease`, so a reload does
 * not leave a lease behind that no port answers for.
 *
 * Nothing here runs at startup. The SharedWorker is constructed, and the
 * packaged wasm assets are fetched, only when an eligible caller first asks for
 * a lease. Production consumers reach this client through exactly one owner —
 * {@link resolvePackagedBrowserIrohEndpointClient}, the tab's lazy packaged
 * client shared by the Home carrier runtime (which carries authenticated Home
 * HTTP and Socket.IO over its streams, behind the
 * `homeCarrier/browserHomeCarrier` seam) and the `happier/machine/1`
 * finite-transfer carrier. QR and Account Service still consume nothing here.
 */

import { BROWSER_IROH_WORKER_ASSET, browserIrohAssetUrl } from './assets';
import {
    attachBrowserIrohPageLifecycleRelease,
    type BrowserIrohPageLifecycle,
} from './pageLifecycleRelease';
import {
    parseBrowserIrohWorkerReply,
    type BrowserIrohClientCommand,
    type BrowserIrohEndpointStatus,
    type BrowserIrohErrorCode,
    type BrowserIrohObservedPath,
    type BrowserIrohStreamKind,
    type BrowserIrohWorkerReply,
} from './protocol';
import type { BrowserIrohMessagePort } from './workerConnection';

export class BrowserIrohClientError extends Error {
    constructor(readonly code: BrowserIrohErrorCode, message: string) {
        super(message);
        this.name = 'BrowserIrohClientError';
    }
}

export type BrowserIrohLease = Readonly<{
    leaseId: string;
    endpointId: string;
    appliedRelayUrls: readonly string[];
    /**
     * Opens one stream under this lease. `streamKind` names the protocol from
     * the closed set; a tab never supplies an ALPN.
     */
    openStream: (input: Readonly<{
        streamKind: BrowserIrohStreamKind;
        endpointId: string;
        relayUrls: readonly string[];
        signal?: AbortSignal;
    }>) => Promise<BrowserIrohStream>;
    release: () => Promise<void>;
}>;

/** Opaque per-tab handle; the worker and Rust/WASM endpoint retain custody. */
export type BrowserIrohStream = Readonly<{
    streamId: string;
    /** The EndpointId the transport cryptographically proved. */
    remoteEndpointId: string;
    observedPath: BrowserIrohObservedPath;
    read: (maxBytes: number) => Promise<Readonly<{ bytes: Uint8Array; done: boolean }>>;
    write: (bytes: Uint8Array) => Promise<void>;
    finishWrite: () => Promise<void>;
    cancel: () => Promise<void>;
    close: () => Promise<void>;
}>;

export type BrowserIrohEndpointClient = Readonly<{
    acquireLease: (relayUrls: readonly string[]) => Promise<BrowserIrohLease>;
    status: () => Promise<BrowserIrohEndpointStatus>;
    /** Releases every lease this tab holds. Siblings keep theirs. */
    releaseAll: () => Promise<void>;
    /**
     * Disposes this tab's client: the page-lifecycle listener is detached and
     * never reattached. It does not release anything on its own; `releaseAll`
     * remains the explicit, awaited lease-release path.
     */
    close: () => void;
}>;

/**
 * One connection to the packaged worker. `onFailure` is what makes a missing or
 * unloadable worker script observable: an app built without the browser Iroh
 * assets still looks eligible to the host check, and without this signal the
 * port would simply never answer.
 */
export type BrowserIrohWorkerConnection = Readonly<{
    port: BrowserIrohMessagePort;
    onFailure: (listener: (reason: string) => void) => void;
}>;

type ConnectWorker = () => BrowserIrohWorkerConnection;

function newRequestId(): string {
    const cryptoRandomUUID = globalThis.crypto?.randomUUID;
    if (typeof cryptoRandomUUID === 'function') {
        return cryptoRandomUUID.call(globalThis.crypto);
    }
    return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? Object.assign(new Error('Browser Iroh request was aborted'), { name: 'AbortError' });
}

/**
 * Connects to the packaged SharedWorker. Constructed lazily by the client, so
 * importing this module costs nothing.
 */
export function connectPackagedBrowserIrohWorker(base: string): BrowserIrohWorkerConnection {
    const url = browserIrohAssetUrl(BROWSER_IROH_WORKER_ASSET, base);
    const SharedWorkerConstructor = (globalThis as Record<string, unknown>).SharedWorker as
        | (new (
            scriptUrl: string,
            options?: { type?: 'module'; name?: string },
        ) => { port: MessagePort; onerror: ((event: unknown) => void) | null })
        | undefined;
    if (SharedWorkerConstructor === undefined) {
        throw new BrowserIrohClientError(
            'endpoint_unavailable',
            'SharedWorker is unavailable in this browser',
        );
    }
    const worker = new SharedWorkerConstructor(url, { type: 'module', name: 'happier-iroh' });
    return {
        port: worker.port,
        onFailure: (listener) => {
            worker.onerror = () => listener(`browser Iroh worker script failed to load: ${url}`);
        },
    };
}

/**
 * The deployment base URL the packaged assets resolve from: the app origin
 * plus the web output's configured base path. Expo inlines its supported
 * subpath setting (`experiments.baseUrl`) as `EXPO_BASE_URL` at build time —
 * the same base the router itself uses — so a deployment hosted under a
 * subpath resolves its own packaged assets too.
 *
 * The current navigation URL is deliberately not consulted (Lane 06 amendment
 * A9): a nested route, a deep reload, or any pushState navigation is location
 * state, not deployment state, and must never move the packaged worker's URL.
 */
function deploymentBaseUrl(): string {
    const origin = (globalThis as { location?: { origin?: unknown } }).location?.origin;
    if (typeof origin !== 'string' || origin.length === 0) {
        return '';
    }
    const basePath = String(process.env.EXPO_BASE_URL ?? '').trim().replace(/^\/+|\/+$/u, '');
    return basePath === '' ? origin : `${origin}/${basePath}`;
}

/** The tab's one packaged client; `null` until a caller first asks for it. */
let packagedTabClient: BrowserIrohEndpointClient | null = null;

/**
 * The one endpoint client lifecycle owner per browser tab (Lane 06): the
 * packaged client shared by the Home carrier owner and machine transfer
 * operations. Resolving is lazy — importing this module or calling this
 * accessor constructs no worker and opens no port; the SharedWorker is
 * connected when the returned client performs its first operation, and never
 * a second time for this tab.
 *
 * Carrier and transfer releases free their own leases and streams but never
 * close this client: the page-lifecycle release attached on connect and an
 * explicit lease release remains the whole-client lifecycle owner.
 */
export function resolvePackagedBrowserIrohEndpointClient(): BrowserIrohEndpointClient {
    packagedTabClient ??= createBrowserIrohEndpointClient(
        () => connectPackagedBrowserIrohWorker(deploymentBaseUrl()),
    );
    return packagedTabClient;
}

/**
 * Test-only reset: the next resolution describes a fresh tab. Production code
 * never calls this — the singleton is the tab's lifetime.
 */
export function resetPackagedBrowserIrohEndpointClientForTests(): void {
    packagedTabClient = null;
}

/**
 * `pageLifecycle` is injected so a test can describe a page without pretending
 * to be one; production reads the host. `null` means this host has no page
 * lifecycle to hook, and the client simply relies on explicit release.
 */
export function createBrowserIrohEndpointClient(
    connect: ConnectWorker,
    pageLifecycle?: BrowserIrohPageLifecycle | null,
): BrowserIrohEndpointClient {
    let connection: BrowserIrohWorkerConnection | null = null;
    let failure: string | null = null;
    let detachPageLifecycle: (() => void) | null = null;
    let closed = false;
    const pending = new Map<string, (reply: BrowserIrohWorkerReply) => void>();

    function fail(reason: string): void {
        failure = reason;
        // Every waiting caller is answered. A worker that never loads must not
        // leave a request outstanding forever.
        for (const [requestId, resolve] of [...pending]) {
            pending.delete(requestId);
            resolve({
                v: 1,
                kind: 'error',
                requestId,
                code: 'endpoint_unavailable',
                message: reason,
            });
        }
    }

    function ensureConnection(): BrowserIrohWorkerConnection {
        if (connection !== null) return connection;
        const connected = connect();
        connected.port.addEventListener('message', (event) => {
            const reply = parseBrowserIrohWorkerReply(event.data);
            if (reply === null) return;
            const resolve = pending.get(reply.requestId);
            if (resolve !== undefined) {
                resolve(reply);
                return;
            }
            if (reply.kind === 'streamOpened') {
                // An abort can remove the waiter after the worker completed
                // but before this queued reply reaches the tab. Return that
                // opaque handle through the same owner instead of leaking it.
                connected.port.postMessage({
                    v: 1,
                    kind: 'closeStream',
                    requestId: newRequestId(),
                    streamId: reply.streamId,
                } satisfies BrowserIrohClientCommand);
            }
        });
        connected.onFailure(fail);
        connected.port.start?.();
        connection = connected;
        // The worker can remain live for sibling contexts after this page ends,
        // so this tab's leases have to be handed back. Attaching here keeps
        // the "nothing until a caller asks" rule: an unused client listens to
        // nothing.
        if (!closed) {
            detachPageLifecycle = attachBrowserIrohPageLifecycleRelease({
                postMessage: (message) => connected.port.postMessage(message),
                newRequestId,
                lifecycle: pageLifecycle,
            });
        }
        return connected;
    }

    async function send(
        build: (requestId: string) => BrowserIrohClientCommand,
        signal?: AbortSignal,
    ): Promise<BrowserIrohWorkerReply> {
        // A worker script that could not load will not load on the next command
        // either; reconnecting would only produce a second silent port.
        if (failure !== null) {
            throw new BrowserIrohClientError('endpoint_unavailable', failure);
        }
        const active = ensureConnection();
        const requestId = newRequestId();
        if (signal?.aborted) throw abortReason(signal);
        let detachAbort: () => void = () => undefined;
        const reply = new Promise<BrowserIrohWorkerReply>((resolve, reject) => {
            pending.set(requestId, resolve);
            if (signal) {
                const onAbort = () => {
                    if (!pending.delete(requestId)) return;
                    active.port.postMessage({
                        v: 1,
                        kind: 'cancelRequest',
                        requestId: newRequestId(),
                        targetRequestId: requestId,
                    } satisfies BrowserIrohClientCommand);
                    reject(abortReason(signal));
                };
                signal.addEventListener('abort', onAbort, { once: true });
                detachAbort = () => signal.removeEventListener('abort', onAbort);
            }
        });
        active.port.postMessage(build(requestId));
        try {
            return await reply;
        } finally {
            detachAbort();
            pending.delete(requestId);
        }
    }

    function requireReply<K extends BrowserIrohWorkerReply['kind']>(
        reply: BrowserIrohWorkerReply,
        kind: K,
    ): Extract<BrowserIrohWorkerReply, { kind: K }> {
        if (reply.kind === 'error') {
            throw new BrowserIrohClientError(reply.code, reply.message);
        }
        if (reply.kind !== kind) {
            throw new BrowserIrohClientError(
                'protocol_violation',
                `Browser Iroh worker answered ${reply.kind} for a ${kind} request`,
            );
        }
        return reply as Extract<BrowserIrohWorkerReply, { kind: K }>;
    }

    const releaseLease = async (leaseId: string): Promise<void> => {
        requireReply(
            await send((requestId) => ({ v: 1, kind: 'releaseLease', requestId, leaseId })),
            'released',
        );
    };

    const streamHandle = (opened: Extract<BrowserIrohWorkerReply, { kind: 'streamOpened' }>): BrowserIrohStream => ({
        streamId: opened.streamId,
        remoteEndpointId: opened.remoteEndpointId,
        observedPath: opened.observedPath,
        read: async (maxBytes) => {
            const read = requireReply(
                await send((requestId) => ({ v: 1, kind: 'readStream', requestId, streamId: opened.streamId, maxBytes })),
                'streamRead',
            );
            return { bytes: read.bytes, done: read.done };
        },
        write: async (bytes) => {
            requireReply(
                await send((requestId) => ({ v: 1, kind: 'writeStream', requestId, streamId: opened.streamId, bytes })),
                'streamWritten',
            );
        },
        finishWrite: async () => {
            requireReply(
                await send((requestId) => ({ v: 1, kind: 'finishStreamWrite', requestId, streamId: opened.streamId })),
                'streamWriteFinished',
            );
        },
        cancel: async () => {
            requireReply(
                await send((requestId) => ({ v: 1, kind: 'cancelStream', requestId, streamId: opened.streamId })),
                'streamCancelled',
            );
        },
        close: async () => {
            requireReply(
                await send((requestId) => ({ v: 1, kind: 'closeStream', requestId, streamId: opened.streamId })),
                'streamClosed',
            );
        },
    });

    return {
        acquireLease: async (relayUrls) => {
            const acquired = requireReply(
                await send((requestId) => ({
                    v: 1,
                    kind: 'acquireLease',
                    requestId,
                    relayUrls: [...relayUrls],
                })),
                'leaseAcquired',
            );
            return {
                leaseId: acquired.leaseId,
                endpointId: acquired.endpointId,
                appliedRelayUrls: acquired.appliedRelayUrls,
                openStream: async ({ streamKind, endpointId, relayUrls, signal }) => streamHandle(requireReply(
                    await send((requestId) => ({
                        v: 1,
                        kind: 'openStream',
                        requestId,
                        leaseId: acquired.leaseId,
                        streamKind,
                        endpointId,
                        relayUrls: [...relayUrls],
                    }), signal),
                    'streamOpened',
                )),
                release: async () => {
                    await releaseLease(acquired.leaseId);
                },
            };
        },


        status: async () =>
            requireReply(await send((requestId) => ({ v: 1, kind: 'status', requestId })), 'status')
                .status,

        releaseAll: async () => {
            requireReply(
                await send((requestId) => ({ v: 1, kind: 'releaseClient', requestId })),
                'released',
            );
        },

        close: () => {
            closed = true;
            detachPageLifecycle?.();
            detachPageLifecycle = null;
        },
    };
}
