import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_AUTO_DEBUG_PUBLIC_ENV_KEY } from './aiAutoDebuggingEnv';

vi.mock('@/config', () => ({
  config: {
    serverUrl: 'https://example.test',
  },
}));

import { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } from './remoteLogger';

const REMOTE_LOG_URL = 'https://example.test/logs-combined-from-cli-and-mobile-for-simple-ai-debugging';

describe('remoteLogger', () => {
  afterEach(() => {
    // Restoring the console spies also removes the patch installed on top of them.
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('redacts voice update payloads before sending them off-device', async () => {
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation(() => {});
    }
    vi.stubEnv(AI_AUTO_DEBUG_PUBLIC_ENV_KEY, '1');
    // Network boundary: the real runtimeFetch resolves to the global fetch outside desktop hosts.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);

    monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
    console.log('🎤 Voice: Reporting contextual update:', 'TOP_SECRET_CONTEXT');

    // The initialization line and the voice line are both forwarded.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([REMOTE_LOG_URL, REMOTE_LOG_URL]);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    const voiceBodies = bodies.filter((body) => String(body.message).includes('🎤 Voice: Reporting contextual update:'));
    expect(voiceBodies).toHaveLength(1);
    expect(voiceBodies[0]?.message).not.toContain('TOP_SECRET_CONTEXT');
    expect(voiceBodies[0]?.messageRawObject).toBeUndefined();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('TOP_SECRET_CONTEXT');
  });
});
