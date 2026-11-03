import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { completeAccountAuthRequest } from './accountCompletion';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import type { HomeQrEnrollmentTarget } from './qrStart';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn<(input: unknown) => typeof endpointFetchMock>(() => endpointFetchMock));
const serverFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (input: unknown) => createServerFetchAtEndpointMock(input),
    serverFetch: (...args: unknown[]) => serverFetchMock(...args),
}));

const descriptor = {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
};
let target: HomeQrEnrollmentTarget;

describe('completeAccountAuthRequest explicit target', () => {
    beforeAll(async () => {
        const resolution = await resolveHomeEnrollmentTransport(descriptor);
        if (!resolution.ok) throw new Error('Expected test Home transport');
        target = { ...resolution.transport, serverId: 'profile-b' };
    });
    afterEach(() => {
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockClear();
        serverFetchMock.mockReset();
    });

    it('sends the strict bound terminal-v3 admission body only to the selected Home', async () => {
        endpointFetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

        await expect(completeAccountAuthRequest({
            token: 'home-b-token',
            target,
            pairId: 'pair-b',
            publicKey: new Uint8Array([1, 2, 3]),
            response: new Uint8Array([4, 5, 6]),
            homeServerIdentityId: 'srv_home_b',
            responseKind: 'tokenOnly',
        })).resolves.toBe('completed');

        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://home-b.test',
            serverId: 'profile-b',
            credentials: { token: 'home-b-token' },
        }));
        expect(endpointFetchMock).toHaveBeenCalledWith('/v1/auth/account/response', expect.objectContaining({
            body: JSON.stringify({
                pairId: 'pair-b',
                publicKey: 'AQID',
                response: 'BAUG',
                homeServerIdentityId: 'srv_home_b',
                responseKind: 'tokenOnly',
            }),
        }), expect.objectContaining({ includeAuth: true }));
        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('forwards lifecycle cancellation to the authenticated completion request', async () => {
        endpointFetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        const controller = new AbortController();

        await expect(completeAccountAuthRequest({
            token: 'home-b-token',
            target,
            pairId: 'pair-b',
            publicKey: new Uint8Array(32),
            response: new Uint8Array([1]),
            homeServerIdentityId: 'srv_home_b',
            responseKind: 'tokenOnly',
            signal: controller.signal,
        })).resolves.toBe('completed');

        expect((endpointFetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
    });

    it('rejects a mismatched target identity before any request', async () => {
        await expect(completeAccountAuthRequest({
            token: 'home-b-token',
            target,
            pairId: 'pair-b',
            publicKey: new Uint8Array(32),
            response: new Uint8Array([1]),
            homeServerIdentityId: 'srv_home_a',
            responseKind: 'dataKey',
        })).rejects.toMatchObject({ code: 'invalid_target' });
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('treats the typed already-completed replay as successful completion', async () => {
        endpointFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'already_completed' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        }));
        await expect(completeAccountAuthRequest({
            token: 'home-b-token',
            target,
            pairId: 'pair-b',
            publicKey: new Uint8Array(32),
            response: new Uint8Array([1]),
            homeServerIdentityId: 'srv_home_b',
            responseKind: 'tokenOnly',
        })).resolves.toBe('already_completed');

        endpointFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'provisioning_kind_mismatch' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        }));
        await expect(completeAccountAuthRequest({
            token: 'home-b-token',
            target,
            pairId: 'pair-b',
            publicKey: new Uint8Array(32),
            response: new Uint8Array([1]),
            homeServerIdentityId: 'srv_home_b',
            responseKind: 'tokenOnly',
        })).rejects.toMatchObject({ code: 'account_completion_failed', status: 409, retryable: false });
    });
});
