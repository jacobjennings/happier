import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { createEnvKeyScope } from '@/testkit/env/envScope';

import { openRemoteAcquisition, type RemoteAcquisitionDestinationPolicy } from './acquisition';
import {
  downloadRemoteFileWithLimits,
  readRemoteJsonResponseWithLimits,
  resolvePluginRemoteArchiveMaxBytes,
  resolvePluginRemoteCatalogMaxBytes,
  resolvePluginRemoteFetchTimeoutMs,
} from './fetch';

const servers: Server[] = [];
const tempDirs: string[] = [];
const archiveEnv = createEnvKeyScope([
  'HAPPIER_PLUGIN_REMOTE_ARCHIVE_MAX_BYTES',
  'HAPPIER_PLUGIN_REMOTE_CATALOG_MAX_BYTES',
  'HAPPIER_PLUGIN_REMOTE_FETCH_TIMEOUT_MS',
]);
const CATALOG_POLICY: RemoteAcquisitionDestinationPolicy = Object.freeze({
  scheme: 'httpOrHttps',
  redirects: 'sameOrigin',
  privateNetwork: 'followCallerDestination',
});

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  archiveEnv.restore();
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  await Promise.all(tempDirs.splice(0).map(async (dir) => await removeTempDir(dir)));
});

describe('remote plugin body budget', () => {
  it('reads a valid catalog beyond the former implicit JSON ceiling without an operator budget', async () => {
    archiveEnv.patch({ HAPPIER_PLUGIN_REMOTE_CATALOG_MAX_BYTES: undefined });
    const padding = 'x'.repeat(2 * 1024 * 1024);
    await expect(readRemoteJsonResponseWithLimits({
      response: new Response(JSON.stringify({ padding })), errorLabel: 'Marketplace catalog',
    })).resolves.toEqual({ padding });
  });

  it('streams a valid archive beyond the former implicit byte ceiling', async () => {
    archiveEnv.patch({ HAPPIER_PLUGIN_REMOTE_ARCHIVE_MAX_BYTES: undefined });
    const chunk = Buffer.alloc(1024 * 1024);
    const port = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      let remainingChunks = 257;
      const writeMore = (): void => {
        while (remainingChunks > 0) {
          remainingChunks -= 1;
          if (!response.write(chunk)) {
            response.once('drain', writeMore);
            return;
          }
        }
        response.end();
      };
      writeMore();
    });
    const dir = await createTempDir('happier-remote-streamed-archive-');
    tempDirs.push(dir);
    const destinationPath = join(dir, 'archive.tgz');
    await downloadRemoteFileWithLimits({
      url: `http://127.0.0.1:${port}/plugin.tgz`, destinationPath, errorLabel: 'Remote plugin archive',
    });
    expect((await stat(destinationPath)).size).toBe(257 * chunk.byteLength);
  });

  it.each([
    ['archive storage budget without the former one-GiB clamp', 'HAPPIER_PLUGIN_REMOTE_ARCHIVE_MAX_BYTES', resolvePluginRemoteArchiveMaxBytes, 2 * 1024 * 1024 * 1024],
    ['catalog buffer budget without the former 32-MiB clamp', 'HAPPIER_PLUGIN_REMOTE_CATALOG_MAX_BYTES', resolvePluginRemoteCatalogMaxBytes, 64 * 1024 * 1024],
  ] as const)('honors an explicit %s', (_label, envName, resolveBudget, budget) => {
    archiveEnv.patch({ [envName]: String(budget) });
    expect(resolveBudget()).toBe(budget);
  });

  it('accepts discovery that settles after the former acquisition cutoff', async () => {
    archiveEnv.patch({ HAPPIER_PLUGIN_REMOTE_FETCH_TIMEOUT_MS: undefined });
    // The acquisition lifetime reads node:perf_hooks; drive that monotonic clock from the fake clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const monotonicClock = vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    onTestFinished(() => monotonicClock.mockRestore());
    let resolveDns!: (answers: readonly { address: string; family: 4 }[]) => void;
    const operation = (async () => {
      const opened = await openRemoteAcquisition({
        url: 'https://catalog.example.test/index.json', headers: { accept: 'application/json' },
        policy: CATALOG_POLICY, timeoutMs: resolvePluginRemoteFetchTimeoutMs(), errorLabel: 'Marketplace catalog',
        resolveAddresses: () => new Promise((resolve) => { resolveDns = resolve; }),
        fetchImpl: async () => new Response('{"ok":true}'),
      });
      try {
        return await readRemoteJsonResponseWithLimits({ response: opened.response, signal: opened.signal, errorLabel: 'Marketplace catalog' });
      } finally {
        await opened.dispose();
      }
    })();
    let settled = false;
    void operation.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(300_001);
    expect(settled).toBe(false);
    resolveDns([{ address: '93.184.216.34', family: 4 }]);
    await expect(operation).resolves.toEqual({ ok: true });
  });

  it('cancels a pending catalog body', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const operation = readRemoteJsonResponseWithLimits({
      response: new Response(new ReadableStream({ cancel() { cancelled = true; } })),
      signal: controller.signal, errorLabel: 'Marketplace catalog',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rejected = expect(operation).rejects.toThrow('body cancelled');
    controller.abort(new Error('body cancelled'));
    await rejected;
    expect(cancelled).toBe(true);
  });

  it('stops a chunked archive that never declares its length once the budget is spent', async () => {
    const port = await startServer((_request, response) => {
      // No content-length: the byte budget is the only bound on this body.
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      for (let chunk = 0; chunk < 64; chunk += 1) response.write('x'.repeat(1024));
      response.end();
    });
    const dir = await createTempDir('happier-remote-body-budget-');
    tempDirs.push(dir);
    const destinationPath = join(dir, 'archive.tgz');

    await expect(downloadRemoteFileWithLimits({
      url: `http://127.0.0.1:${port}/plugin.tgz`,
      destinationPath,
      maxBytes: 2048,
      errorLabel: 'Remote plugin archive',
    })).rejects.toThrow('Remote plugin archive exceeds the configured size limit (2048 bytes)');

    const written = await readFile(destinationPath).catch(() => Buffer.alloc(0));
    expect(written.byteLength).toBeLessThanOrEqual(2048 + 1024);
  });

  it('writes a chunked archive that stays inside its budget', async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.write('archive-');
      response.end('bytes');
    });
    const dir = await createTempDir('happier-remote-body-budget-');
    tempDirs.push(dir);
    const destinationPath = join(dir, 'archive.tgz');

    await downloadRemoteFileWithLimits({
      url: `http://127.0.0.1:${port}/plugin.tgz`,
      destinationPath,
      maxBytes: 2048,
      errorLabel: 'Remote plugin archive',
    });

    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('archive-bytes');
  });

  it('applies the same budget to a chunked catalog document', async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('[');
      for (let chunk = 0; chunk < 64; chunk += 1) response.write(`"${'x'.repeat(1022)}",`);
      response.end('""]');
    });

    const opened = await openRemoteAcquisition({
      url: `http://127.0.0.1:${port}/catalog.json`, headers: { accept: 'application/json' },
      policy: CATALOG_POLICY, timeoutMs: 5_000, errorLabel: 'Marketplace catalog',
    });
    try {
      await expect(readRemoteJsonResponseWithLimits({
        response: opened.response, signal: opened.signal, maxBytes: 2048, errorLabel: 'Marketplace catalog',
      })).rejects.toThrow('Marketplace catalog exceeds the configured size limit (2048 bytes)');
    } finally {
      await opened.dispose();
    }
  });
});
