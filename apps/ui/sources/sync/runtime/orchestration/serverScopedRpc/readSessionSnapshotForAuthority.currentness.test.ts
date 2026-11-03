import { afterEach, expect, it } from 'vitest';
import { serveAccountHomes } from '@/dev/testkit/harness/actionHomesHttpHarness';
import { countTransportRequests, standardCleanup } from '@/dev/testkit';
import { createPlainSessionCurrentProjectionRecordFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createEmptyAccountBootstrapHttpResponse } from '@/dev/testkit/fixtures/accountBootstrapHttpBoundary';
import { createAccountKvHttpFixture } from '@/dev/testkit/fixtures/accountKvHttpFixture';
import { publishAppliedActiveServerSnapshot } from '@/sync/runtime/orchestration/appliedActiveServerRuntime';
import { retireActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { captureUiUsageQueryAccountContext } from '@/sync/api/account/usageQueryResource';
import { invalidateAccountEncryptionModeCache, updateAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { createOperationAccountCurrentnessSource } from './fetchSessionByIdWithServerScope';
import { runWithServerRequestAuthorityForServerAccountScope } from './createServerRequestWithServerScope';
import { readSessionSnapshotForAuthority } from './readSessionSnapshotForAuthority';
import { createSessionReadBatchHttpBoundary } from '@/dev/testkit/harness/sessionReadBatchHttpBoundary';

let home: Awaited<ReturnType<typeof serveAccountHomes>> | undefined;
afterEach(async () => { standardCleanup(); retireActiveServerAccountScopeLifetime(); await home?.dispose(); home = undefined; });

it.each(['scope-reset', 'account-encryption-change', 'same-home-resume', 'same-home-mode-setter', 'unknown-home-semantic-change', 'home-identity-promotion'] as const)(
  'reuses one finite scoped observation and admits private reads according to %s invalidation', async (invalidation) => {
  const kv = createAccountKvHttpFixture();
  const sessions = createSessionReadBatchHttpBoundary(async request => {
      const kvResponse = await kv.handleFetch(request.url, { method: request.method,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }) });
      if (kvResponse) return kvResponse;
      if (request.path === '/v1/account/encryption') return Response.json({ mode: 'plain', updatedAt: 0 });
      if (/^\/v2\/sessions\/batch-\d+$/.test(request.path)) return Response.json({ session:
        createPlainSessionCurrentProjectionRecordFixture({ id: request.path.split('/').at(-1)! }) });
      const turn = /^\/v1\/sessions\/(batch-\d+)\/turns$/.exec(request.path);
      if (turn) return Response.json({ v: 1, sessionId: turn[1], updatedAt: 1, turns: [] });
      return createEmptyAccountBootstrapHttpResponse(request.path, { method: request.method }) ?? undefined;
    });
  home = await serveAccountHomes({ homes: [{ key: 'a', serverUrl: 'https://snapshot-batch-currentness.test', accountId: 'account-a' }],
    route: request => sessions.handle(request) });
  publishAppliedActiveServerSnapshot({ serverId: home.homes.a!.id, serverUrl: home.homes.a!.serverUrl, generation: 0 });
  const { TokenStorage } = await import('@/auth/storage/tokenStorage');
  const credentials = (await TokenStorage.getCredentialsForServerUrl(home.homes.a!.serverUrl))!;
  const context = captureUiUsageQueryAccountContext(credentials)!;
  const { sync } = await import('@/sync/sync');
  // Restore has already started bootstrap. Establish its foreground boundary
  // instead of racing a second recovery against this finite read-cost phase.
  await sync.awaitBootstrapForegroundAcquisition();
  await runWithServerRequestAuthorityForServerAccountScope({ scope: context.accountLifetime.scope, activeRequest: context.request }, async authority => {
    // Count this finite observation's physical HTTP boundary; ordinary Sync
    // background maintenance on the same Account is a separate operation.
    const requests = countTransportRequests((path: string, init: RequestInit) => authority.request(path, init), path => path);
    const currentnessReads = () => requests.read()['/v1/account/encryption/currentness'] ?? 0;
    const currentness = createOperationAccountCurrentnessSource({ credentials, request: requests.request,
      serverId: authority.scope.serverId });
    try {
    const rows = await Promise.all(['batch-1', 'batch-2'].map(sessionId => readSessionSnapshotForAuthority({
      // This finite-observation cost test counts maintenance too. Ordinary
      // first-open latency is covered by the held-PATCH composed journey.
      authority, sessionId, accountCurrentnessSource: currentness, awaitDisplayProjectionMaintenance: true,
    })));
    expect(rows.map(row => row.session.id)).toEqual(['batch-1', 'batch-2']);
    expect(currentnessReads()).toBe(1);
    const detailReads = sessions.componentRequests.filter(request => request.path === '/v2/sessions/batch-3').length;
    if (invalidation === 'scope-reset') {
      // Retiring the runtime scope is terminal for its finite observations.
      invalidateAccountEncryptionModeCache({ reason: 'scope-reset' });
    }
    // Mode/key replacement is announced by the existing encryption owner. A
    // completed observation must become unusable, rather than serve stale mode.
    if (invalidation === 'same-home-resume') await sync.resumeSync('manual');
    else if (invalidation === 'same-home-mode-setter') await updateAccountEncryptionMode(credentials, 'plain', { retry: 'none' });
    else if (invalidation === 'unknown-home-semantic-change') invalidateAccountEncryptionModeCache({ serverId: 'unresolvable-home' });
    else if (invalidation === 'home-identity-promotion') {
      // The real feature/adoption owner can learn a portable identity without
      // replacing credentials or the established device-local profile.
      const { setServerProfileIdentityForUrl } = await import('@/sync/domains/server/serverProfiles');
      await setServerProfileIdentityForUrl(home!.homes.a!.serverUrl, 'srv_currentness_promoted');
      invalidateAccountEncryptionModeCache({ serverId: 'srv_currentness_promoted' });
    }
    else if (invalidation !== 'scope-reset') invalidateAccountEncryptionModeCache();
    if (invalidation === 'same-home-resume') {
      expect(currentness.isCurrent()).toBe(true);
      // A successful catch-up need not replace the physical socket. Exercise
      // its withdrawal contract explicitly instead of depending on whether
      // concurrent bootstrap happened to reconnect during this resume.
      invalidateAccountEncryptionModeCache({ serverId: authority.scope.serverId, reason: 'transport-withdrawal' });
      const afterResume = currentnessReads();
      expect((await readSessionSnapshotForAuthority({ authority, sessionId: 'batch-3', accountCurrentnessSource: currentness, awaitDisplayProjectionMaintenance: true })).session.id)
        .toBe('batch-3');
      expect(currentnessReads()).toBe(afterResume + 1);
      return;
    }
    expect(currentness.isCurrent()).toBe(false);
    await expect(readSessionSnapshotForAuthority({ authority, sessionId: 'batch-3', accountCurrentnessSource: currentness, awaitDisplayProjectionMaintenance: true }))
      .rejects.toMatchObject({ code: 'account_encryption_currentness_changed' });
    expect(sessions.componentRequests.filter(request => request.path === '/v2/sessions/batch-3')).toHaveLength(detailReads);
    const currentnessReadsAfterInvalidation = currentnessReads();
    // Recovery is a new finite observation, through the same strict HTTP owner.
    const replacement = createOperationAccountCurrentnessSource({ credentials, request: requests.request,
      serverId: authority.scope.serverId });
    try {
    expect((await readSessionSnapshotForAuthority({ authority, sessionId: 'batch-3', accountCurrentnessSource: replacement, awaitDisplayProjectionMaintenance: true })).session.id)
      .toBe('batch-3');
    expect(currentnessReads()).toBe(currentnessReadsAfterInvalidation + 1);
    } finally { replacement.dispose(); }
    } finally { currentness.dispose(); }
  });
});
