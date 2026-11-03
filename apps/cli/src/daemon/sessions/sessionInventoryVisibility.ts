import type { CompactSessionListPageV1 } from '@/session/transport/http/sessionsHttp';

export type SessionInventoryScope = 'active' | 'archived';

export type SessionInventoryVisibilityPage = Readonly<{
  sessions: readonly Readonly<{ id?: unknown }>[];
  nextCursor: string | null;
  hasNext: boolean;
}>;

export type SessionInventoryVisibilityPageFetcher = (args: Readonly<{
  scope: SessionInventoryScope;
  cursor?: string;
  signal?: AbortSignal;
}>) => Promise<SessionInventoryVisibilityPage>;

export async function fetchSessionInventoryPage(args: Readonly<{
  token: string;
  scope: SessionInventoryScope;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}>): Promise<CompactSessionListPageV1> {
  const { fetchSessionListPage } = await import('@/session/transport/http/sessionsHttp');
  const { scope, ...request } = args;
  return await fetchSessionListPage({
    ...request,
    ...(scope === 'archived' ? { archivedOnly: true } : { activeOnly: false }),
  });
}

/** Walk only the caller's eligible inventories; callers own removal policy. */
export async function collectRetainedSessionInventoryVisibility(params: Readonly<{
  retainedSessionIds: readonly string[];
  scopes: readonly SessionInventoryScope[];
  fetchInventoryPage: SessionInventoryVisibilityPageFetcher;
  signal?: AbortSignal;
}>): Promise<ReadonlySet<string>> {
  const retained = new Set(params.retainedSessionIds);
  const visible = new Set<string>();
  if (retained.size === 0) return visible;
  for (const scope of params.scopes) {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (;;) {
      params.signal?.throwIfAborted();
      const page = await params.fetchInventoryPage({
        scope,
        ...(cursor === undefined ? {} : { cursor }),
        ...(params.signal ? { signal: params.signal } : {}),
      });
      params.signal?.throwIfAborted();
      for (const row of page.sessions) {
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        if (id && retained.has(id)) visible.add(id);
      }
      if (visible.size === retained.size) return visible;
      if (!page.hasNext) break;
      if (!page.nextCursor) throw new Error('session_inventory_incomplete');
      if (seenCursors.has(page.nextCursor)) throw new Error('session_inventory_cursor_stalled');
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }
  return visible;
}
