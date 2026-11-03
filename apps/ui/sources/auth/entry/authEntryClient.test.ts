import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1 } from '@happier-dev/protocol/auth/entry';

import { createAccountTokenForTests } from '@/dev/testkit/harness/homeGovernanceHarness';
import { createPlainAccountEncryptionCurrentnessFixture } from '@/dev/testkit/fixtures/accountEncryptionCurrentness';
import { initializeAuthRouteRuntimeForTests } from '@/dev/testkit/harness/authRouteRuntimeHarness';

// Real HTTP client and Account request authority over the runtimeFetch network boundary.
await initializeAuthRouteRuntimeForTests();
const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
const { TokenStorage } = await import('@/auth/storage/tokenStorage');
const { upsertServerProfile } = await import('@/sync/domains/server/serverProfiles');
const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
const { fetchAuthEntry, fetchHomeAuthEntry } = await import('./authEntryClient');
const { resetServerReachabilitySupervisors } = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');

type SentRequest = Readonly<{ url: string; method: string; body: unknown; authorization: string | null }>;
const sent: SentRequest[] = [];
let answer: (url: URL) => Response = () => new Response('{}', { status: 404 });
let reachabilityAnswers = true;

function unavailableProjection(scope: Readonly<{ kind: string }>) {
    return Response.json({ v: 1, state: 'unavailable', scope, reason: 'entry_not_available', autoRedirect: null });
}

function entryRequests(): SentRequest[] {
    return sent.filter(({ url }) => new URL(url).pathname === '/v1/auth/entry');
}

beforeEach(async () => {
    sent.length = 0;
    answer = () => new Response('{}', { status: 404 });
    reachabilityAnswers = true;
    setRuntimeFetch(async (input, init) => {
        const url = new URL(String(input));
        sent.push({
            url: url.href,
            method: String(init?.method ?? 'GET'),
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
            authorization: new Headers(init?.headers).get('authorization'),
        });
        if (url.pathname === '/v1/auth/entry') return answer(url);
        // A Plain Account Home: the request authority observes its Account encryption currentness.
        if (url.pathname === '/health' || url.pathname === '/v1/auth/ping') {
            return reachabilityAnswers ? Response.json({ ok: true }) : await new Promise<Response>(() => {});
        }
        if (url.pathname === '/v1/account/encryption') return Response.json({ mode: 'plain', updatedAt: 1 });
        if (url.pathname === '/v1/account/encryption/currentness') return Response.json(createPlainAccountEncryptionCurrentnessFixture());
        return new Response('{}', { status: 404 });
    });
    await upsertAndActivateServer({ serverUrl: 'https://focused.example.test', name: 'Focused Home' });
});

let homeSequence = 0;

/** A saved Home holding one Account credential; unique per test so device caches never carry over. */
async function addHomeWithAccount(accountId: string) {
    const home = await upsertServerProfile({ serverUrl: `https://team-home-${homeSequence++}.example.test`, name: accountId });
    const token = createAccountTokenForTests(accountId);
    expect(await TokenStorage.setCredentialsForServerUrl(home.serverUrl, { serverId: home.id }, { token })).toBe(true);
    return { ...home, token };
}

describe('fetchHomeAuthEntry', () => {
    it('parses the current projection and rejects malformed new shapes', async () => {
        answer = () => Response.json({
            v: 1,
            state: 'ready',
            scope: { kind: 'home' },
            actions: [{
                kind: 'authenticate',
                methodId: 'acme',
                action: 'login',
                mode: 'keyless',
                origin: 'home',
                presentation: { displayName: 'Acme' },
            }],
            autoRedirect: null,
        });
        await expect(fetchHomeAuthEntry()).resolves.toMatchObject({ kind: 'ready' });
        expect(entryRequests()).toEqual([{
            url: 'https://focused.example.test/v1/auth/entry',
            method: 'POST',
            body: { v: 1, scope: { kind: 'home' } },
            authorization: null,
        }]);

        answer = () => Response.json({ v: 2, state: 'ready', scope: { kind: 'home' }, actions: [], autoRedirect: null });
        await expect(fetchHomeAuthEntry()).resolves.toEqual({ kind: 'incompatible' });
    });

    it('reports endpoint absence separately so released Home fallback stays bounded', async () => {
        answer = () => new Response('', { status: 404 });
        await expect(fetchHomeAuthEntry()).resolves.toEqual({ kind: 'unsupported' });
    });

    it('asks for the projection without waiting on focused-Home reachability supervision', async () => {
        // The sign-in screen needs the entry projection while the Home's reachability probes are still unanswered.
        await resetServerReachabilitySupervisors();
        reachabilityAnswers = false;
        answer = () => unavailableProjection({ kind: 'home' });

        await expect(fetchHomeAuthEntry()).resolves.toMatchObject({ kind: 'ready' });
        expect(sent.map(({ url }) => new URL(url).pathname)).toEqual(['/v1/auth/entry']);
    });

    it('forwards a Home email hint to the existing entry authority without choosing a provider locally', async () => {
        answer = () => unavailableProjection({ kind: 'home' });

        await expect(fetchHomeAuthEntry({ email: 'person@acme.example' })).resolves.toMatchObject({
            kind: 'ready', projection: { state: 'unavailable' },
        });
        expect(entryRequests().map(({ body }) => body)).toEqual([
            { v: 1, scope: { kind: 'home' }, email: 'person@acme.example' },
        ]);
    });

    const explicitEndpointScopes: ReadonlyArray<{ name: string; input: Parameters<typeof fetchAuthEntry>[0] }> = [
        { name: 'an immutable Team scope', input: { scope: { kind: 'team', teamId: 'team_1' }, endpointUrl: 'https://home.example.test', serverId: 'home_1' } },
        { name: 'the exact native verification bearer', input: { scope: { kind: 'native_email_verification', token: 'v'.repeat(43) }, endpointUrl: 'https://home.example.test', serverId: 'home_1' } },
    ];
    it.each(explicitEndpointScopes)('posts $name only to the supplied explicit Home endpoint', async ({ input }) => {
        answer = () => unavailableProjection({ kind: 'team' });

        await expect(fetchAuthEntry(input)).resolves.toMatchObject({ kind: 'ready' });
        expect(entryRequests()).toEqual([{
            url: 'https://home.example.test/v1/auth/entry',
            method: 'POST',
            body: { v: 1, scope: input.scope },
            authorization: null,
        }]);
    });

    it('asks as the exact authenticated Account when a caller supplies its scope', async () => {
        const home = await addHomeWithAccount('account_1');
        answer = () => Response.json({
            v: 1,
            state: 'already_member',
            scope: { kind: 'team' },
            home: { serverId: home.id, displayName: 'Acme Home', storageMode: 'plain' },
            account: { firstName: 'Alice', lastName: null, username: 'alice', avatarUrl: null },
            team: { teamId: 'team_1', name: 'Acme', logo: null },
            actions: [{ kind: 'continue' }],
            autoRedirect: null,
        });

        await expect(fetchAuthEntry({
            scope: { kind: 'team', teamId: 'team_1' },
            endpointUrl: home.serverUrl,
            serverId: home.id,
            accountScope: { serverId: home.id, accountId: 'account_1' },
        })).resolves.toMatchObject({ kind: 'ready', projection: { state: 'already_member' } });

        // The bearer is that exact Home Account's, never ambient focused-Home state or an anonymous request.
        expect(entryRequests()).toEqual([{
            url: `${home.serverUrl}/v1/auth/entry`,
            method: 'POST',
            body: { v: 1, scope: { kind: 'team', teamId: 'team_1' } },
            authorization: `Bearer ${home.token}`,
        }]);
    });

    it('does not fall back to an anonymous projection when exact authority fails', async () => {
        const home = await addHomeWithAccount('another_account');
        answer = () => unavailableProjection({ kind: 'team' });

        await expect(fetchAuthEntry({
            scope: { kind: 'team', teamId: 'team_1' },
            endpointUrl: home.serverUrl,
            serverId: home.id,
            accountScope: { serverId: home.id, accountId: 'account_1' },
        })).resolves.toEqual({ kind: 'unavailable' });
        expect(entryRequests()).toEqual([]);
    });

    it('rejects a declared oversized response before reading its JSON', async () => {
        let cancelled = false;
        let pulled = false;
        answer = () => new Response(new ReadableStream<Uint8Array>({
            pull: (controller) => {
                pulled = true;
                controller.enqueue(new TextEncoder().encode('{}'));
                controller.close();
            },
            cancel: () => { cancelled = true; },
        }, { highWaterMark: 0 }), {
            status: 200,
            headers: { 'content-length': String(AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1 + 1) },
        });

        await expect(fetchHomeAuthEntry()).resolves.toEqual({ kind: 'incompatible' });
        expect(cancelled).toBe(true);
        expect(pulled).toBe(false);
    });

    it('cancels a streamed response once it exceeds the pre-auth metadata byte budget', async () => {
        let cancelled = false;
        const chunks = [new Uint8Array(AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1), new Uint8Array([0x20])];
        const response = { body: null as ReadableStream<Uint8Array> | null };
        answer = () => {
            response.body = new ReadableStream<Uint8Array>({
                pull: (controller) => {
                    const next = chunks.shift();
                    if (next) controller.enqueue(next);
                    else controller.close();
                },
                cancel: () => { cancelled = true; },
            }, { highWaterMark: 0 });
            return new Response(response.body, { status: 200 });
        };

        await expect(fetchHomeAuthEntry()).resolves.toEqual({ kind: 'incompatible' });
        expect(cancelled).toBe(true);
        expect(chunks).toEqual([]);
        expect(response.body?.locked).toBe(false);
    });
});
