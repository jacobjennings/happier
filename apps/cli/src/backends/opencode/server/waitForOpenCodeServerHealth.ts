import { logger } from '@/ui/logger';
import { isOpenCodeServerReadyResponse, OPEN_CODE_AUTO_READINESS_PATHS, OPEN_CODE_V2_READINESS_PATHS } from './openCodeServerReadiness';

export async function waitForOpenCodeServerHealth(params: {
  baseUrl: string;
  timeoutMs: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Released V2 may require a different Basic username from retained V1/reverse-proxy auth. */
  v2Headers?: Record<string, string>;
  apiGeneration?: 'auto' | 'v2';
  onReady?: (apiGeneration: 'auto' | 'v2') => void;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  // Reuse the existing request slice as the backoff ceiling, inside the caller's budget.
  const requestSliceMs = Math.min(1_500, params.pollIntervalMs * 5);
  let delayMs = params.pollIntervalMs;
  let lastFailure = 'no readiness response';
  let retries = 0;
  const paths = params.apiGeneration === 'v2' ? OPEN_CODE_V2_READINESS_PATHS : OPEN_CODE_AUTO_READINESS_PATHS;
  while (Date.now() < deadline) {
    params.signal?.throwIfAborted();
    for (const path of paths) {
      if (Date.now() >= deadline) break;
      params.signal?.throwIfAborted();
      const url = new URL(`${params.baseUrl}${path}`);
      // Never include userinfo or query parameters in diagnostics.
      const target = `${url.origin}${url.pathname}`;
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      params.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), Math.min(requestSliceMs, Math.max(1, deadline - Date.now())));
      timer.unref?.();
      let ready = false;
      try {
        const headers = path.startsWith('/api/') ? params.v2Headers ?? params.headers : params.headers;
        const response = await fetch(url, { signal: ctrl.signal, headers });
        lastFailure = `GET ${target}: HTTP ${response.status}`;
        if (response.ok) {
          const body: unknown = await response.json();
          ready = isOpenCodeServerReadyResponse(path, body);
          if (!ready) lastFailure += ' (invalid readiness response)';
        } else {
          await response.body?.cancel();
        }
      } catch (error) {
        const cause = error instanceof Error ? error.cause : null;
        const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
          ? cause.code : error instanceof Error ? error.name : 'request failed';
        lastFailure = `GET ${target}: ${code}`;
      } finally {
        clearTimeout(timer);
        params.signal?.removeEventListener('abort', onAbort);
      }
      params.signal?.throwIfAborted();
      if (ready) {
        if (retries > 0) logger.infoFile('[OpenCodeServer] Readiness recovered', { retries, target });
        params.onReady?.(path.startsWith('/api/') ? 'v2' : 'auto');
        return;
      }
    }
    if (retries === 0) logger.infoFile('[OpenCodeServer] Waiting for readiness', { lastFailure });
    retries += 1;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(params.signal?.reason);
      };
      const timer = setTimeout(() => {
        params.signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.min(delayMs, remainingMs));
      params.signal?.addEventListener('abort', onAbort, { once: true });
      if (params.signal?.aborted) onAbort();
    });
    delayMs = Math.min(delayMs * 2, requestSliceMs);
  }
  throw new Error(`Timed out waiting for OpenCode server health after ${params.timeoutMs}ms; ${lastFailure}`);
}
