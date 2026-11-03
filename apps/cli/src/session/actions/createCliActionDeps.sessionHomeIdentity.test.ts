import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionExecutor } from '@happier-dev/protocol';
import { normalizeActionsSettingsV1 } from '@happier-dev/protocol/actions/actionSettings';
import { createPlainSessionOwnerMetadataEnvelopeV1, SessionMetadataOwnerPatchV1Schema } from '@happier-dev/protocol/sessions/metadata/sessionMetadataSchemasV1';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { createCliActionDeps } from './createCliActionDeps';

afterEach(() => vi.restoreAllMocks());

describe('Session Action Home identity admission', () => {
  it.each([true, false])('clears reviewer override %s back to the Account default without redundant writes', async enabled => {
    const sessionId = 'c111111111111111111111111';
    const credentials = { token: 'token', encryption: null };
    const session = createSessionRecordFixture({ id: sessionId, encryptionMode: 'plain', metadataLayoutVersion: 1, share: null,
      metadata: JSON.stringify({ v: 1 }),
      ownerMetadata: createPlainSessionOwnerMetadataEnvelopeV1({ v: 1, workspace: { path: '/repo', host: 'host' } }) });
    vi.spyOn(axios, 'get').mockImplementation(async url => {
      if (String(url).endsWith('/v1/account/encryption/currentness')) return { status: 200, data: {
        mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 } };
      if (String(url).endsWith(`/v2/sessions/${sessionId}`)) return { status: 200, data: { session } };
      throw new Error(`Unexpected HTTP read: ${url}`);
    });
    const patch = vi.spyOn(axios, 'patch').mockImplementation(async (_url, body) => {
      const mutation = SessionMetadataOwnerPatchV1Schema.parse(body);
      session.ownerMetadata = mutation.ownerMetadata;
      session.metadata = mutation.sharedMetadata.ciphertext;
      session.metadataVersion += 1;
      return { status: 200, data: { success: true, metadataLayoutVersion: 1,
        sharedMetadata: { version: session.metadataVersion }, agentState: { version: 1 } } };
    });
    const executor = createActionExecutor(createCliActionDeps({ token: credentials.token, credentials,
      sessionId: 'cli-global', mode: 'plain', ctx: null }));
    const context = { surface: 'cli', authority: 'present_user' } as const;
    const write = (value: boolean | null) => executor.execute('session.approval_reviewer.set', { sessionId, enabled: value }, context);
    const read = () => {
      const owner = session.ownerMetadata;
      if (!owner || owner.t !== 'plain') throw new Error('Expected plain owner metadata');
      return owner.v.runtime;
    };
    expect(await write(enabled)).toMatchObject({ ok: true });
    expect(read()?.approvalReviewerEnabled).toBe(enabled);
    expect(await write(null)).toMatchObject({ ok: true });
    expect(read() ?? {}).not.toHaveProperty('approvalReviewerEnabled');
    const writes = patch.mock.calls.length;
    expect(await write(null)).toMatchObject({ ok: true });
    expect(patch.mock.calls).toHaveLength(writes);
  });

  it.each(['memory-profile', 'srv_memory_home', 'foreign-home', undefined])('admits only the bound Home for %s', async serverId => {
    const sessionId = 'c111111111111111111111111';
    const home = 'https://session-home.test';
    const credentials = { token: 'token', encryption: null };
    const session = createSessionRecordFixture({ id: sessionId, encryptionMode: 'plain', metadataLayoutVersion: 1, share: null,
      metadata: JSON.stringify({ v: 1 }),
      ownerMetadata: createPlainSessionOwnerMetadataEnvelopeV1({ v: 1, workspace: { path: '/repo', host: 'host' } }) });
    // HTTP is the only replaced boundary; Action dispatch, guards, schemas and metadata mutation stay real.
    const get = vi.spyOn(axios, 'get').mockImplementation(async url => {
      expect(new URL(String(url)).origin).toBe(home);
      if (String(url).endsWith('/v1/account/encryption/currentness')) return { status: 200, data: {
        mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 } };
      if (String(url).endsWith(`/v2/sessions/${sessionId}`)) return { status: 200, data: { session } };
      throw new Error(`Unexpected HTTP read: ${url}`);
    });
    const post = vi.spyOn(axios, 'post').mockImplementation(async (url, body) => {
      expect(String(url)).toBe(`${home}/v1/sessions/${sessionId}/manager`);
      expect(body).toEqual({ managerSessionId: null, expectedManagerSessionId: null });
      return { status: 200, data: { ok: true, sessionId, managerSessionId: null, attachedAt: null } };
    });
    const put = vi.spyOn(axios, 'put').mockImplementation(async (url, body) => {
      expect(String(url)).toBe(`${home}/v2/session-organization/attention-standings/${sessionId}`);
      expect(body).toEqual({ standing: false });
      return { status: 200, data: { standing: null } };
    });
    const patch = vi.spyOn(axios, 'patch').mockImplementation(async (url, body) => {
      expect(String(url)).toBe(`${home}/v2/sessions/${sessionId}`);
      const mutation = SessionMetadataOwnerPatchV1Schema.parse(body);
      expect(mutation).toMatchObject({ ownerMetadata: { t: 'plain', v: { runtime: { approvalReviewerEnabled: true } } } });
      return { status: 200, data: { success: true, metadataLayoutVersion: 1,
        sharedMetadata: { version: 2 }, agentState: { version: 1 } } };
    });
    const executor = createActionExecutor(createCliActionDeps({ token: credentials.token, credentials,
      sessionId: 'cli-global', mode: 'plain', ctx: null, serverId: 'memory-profile',
      serverIdentityId: 'srv_memory_home', serverHttpBaseUrl: home }));
    const context = { surface: 'cli', authority: 'present_user', ...(serverId ? { serverId } : {}),
      actionsSettings: normalizeActionsSettingsV1({ v: 1, approvalWaivedSurfaces: {
        'session.manager.set': ['cli'], 'session.approval_reviewer.set': ['cli'],
      } }),
    } as const;
    const results = [
      await executor.execute('session.manager.set', { sessionId, managerSessionId: null, expectedManagerSessionId: null }, context),
      await executor.execute('session.attention.set', { sessionId, standing: false }, context),
      await executor.execute('session.approval_reviewer.set', { sessionId, enabled: true }, context),
    ];
    if (serverId === 'foreign-home') {
      for (const result of results) expect(result).toMatchObject({ ok: false, errorCode: 'server_target_mismatch' });
      for (const boundary of [get, post, put, patch]) expect(boundary).not.toHaveBeenCalled();
    } else {
      expect(results, JSON.stringify(results)).toMatchObject([{ ok: true, result: { ok: true, managerSessionId: null } },
        { ok: true, result: { standing: null } }, { ok: true, result: { updated: true } }]);
    }
  });
});
