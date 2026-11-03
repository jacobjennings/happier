export const TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY = 'happier:terminalConnect:webBootstrapHash:v1';

function normalizeWebPathname(raw: string): string {
    let path = String(raw ?? '');
    if (!path.startsWith('/')) path = `/${path}`;
    return path.replace(/\/+$/, '') || '/';
}

function isTerminalConnectPath(pathname: string): boolean {
    return normalizeWebPathname(pathname) === '/terminal/connect';
}

/**
 * Work around Expo Router's initial web linking handling when a deep-link includes a hash fragment.
 *
 * We stash the fragment in sessionStorage and remove it from the visible URL *before* the router initializes.
 * The terminal connect route then reads the stashed fragment and clears it.
 */
export function bootstrapTerminalConnectWebHash(params: Readonly<{
    url: URL;
    sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    history: Pick<History, 'replaceState'>;
}>): void {
    if (!isTerminalConnectPath(params.url.pathname)) return;
    const hash = String(params.url.hash ?? '');
    if (!hash) return;
    // Key links (`#key=`) and descriptor links (`#v4=`, buildTerminalConnectWebHref) both carry the pairing payload.
    if (!/[#&](?:key|v4)=/.test(hash)) return;

    try {
        params.sessionStorage.setItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY, hash);
    } catch {
        // Keep the hash visible when storage cannot take custody.
        return;
    }

    try {
        const normalizedPath = normalizeWebPathname(params.url.pathname);
        const search = String(params.url.search ?? '');
        params.history.replaceState(null, '', `${normalizedPath}${search}`);
    } catch {
        invalidateTerminalConnectWebBootstrapHash(params.sessionStorage);
    }
}

function invalidateTerminalConnectWebBootstrapHash(
    sessionStorage: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
    try { sessionStorage.setItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY, ''); } catch { /* best-effort tombstone */ }
    try { sessionStorage.removeItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY); } catch { /* tombstone remains */ }
}

export function consumeTerminalConnectWebBootstrapHash(
    sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): string | null {
    let stored: string | null;
    try { stored = sessionStorage.getItem(TERMINAL_CONNECT_WEB_BOOTSTRAP_STORAGE_KEY); } catch { return null; }
    if (!stored) return null;
    invalidateTerminalConnectWebBootstrapHash(sessionStorage);
    return stored;
}
