import { afterEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import { authQRStart, generateAuthKeyPair } from './qrStart';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn<(input: unknown) => typeof endpointFetchMock>(() => endpointFetchMock));
const serverFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (input: unknown) => createServerFetchAtEndpointMock(input),
    serverFetch: (...args: unknown[]) => serverFetchMock(...args),
}));

describe('authQRStart explicit target', () => {
    const descriptor = {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
    };
    const enrollmentTarget = async (endpointUrl: string, serverId?: string) => {
        const resolved = await resolveHomeEnrollmentTransport(descriptor);
        if (!resolved.ok) throw new Error('Expected test Home transport');
        return { ...resolved.transport, endpointUrl, ...(serverId ? { serverId } : {}) };
    };
    afterEach(() => {
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockClear();
        createServerFetchAtEndpointMock.mockImplementation(() => endpointFetchMock);
        serverFetchMock.mockReset();
    });

    it('generates an X25519 public key from the retained secret scalar', () => {
        const keypair = generateAuthKeyPair();
        expect(keypair.secretKey).toHaveLength(tweetnacl.box.secretKeyLength);
        expect(keypair.publicKey).toEqual(tweetnacl.box.keyPair.fromSecretKey(keypair.secretKey).publicKey);
    });

    it('sends the enrollment request to the explicit Home endpoint without consulting the active server', async () => {
        endpointFetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        const controller = new AbortController();

        await expect(authQRStart(
            generateAuthKeyPair(),
            await enrollmentTarget('https://home-b.test', 'profile-b'),
            { signal: controller.signal },
        )).resolves.toEqual({ ok: true });

        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://home-b.test',
            serverId: 'profile-b',
            credentials: null,
        }));
        expect(endpointFetchMock.mock.calls[0]?.[0]).toBe('/v2/auth/account/request');
        const init = endpointFetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(init.signal).toBe(controller.signal);
        expect(JSON.parse(String(init.body))).toEqual({
            publicKey: expect.any(String),
        });
        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('reports failure without retrying through the active-server wrapper', async () => {
        endpointFetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

        await expect(authQRStart(generateAuthKeyPair(), await enrollmentTarget('https://home-b.test'))).resolves.toEqual({
            ok: false,
            reason: 'transient',
            status: 0,
        });

        expect(serverFetchMock).not.toHaveBeenCalled();
    });

    it('rejects a target without a usable endpoint URL', async () => {
        await expect(authQRStart(generateAuthKeyPair(), await enrollmentTarget('   '))).resolves.toEqual({
            ok: false,
            reason: 'invalid_target',
            status: 0,
        });
        expect(createServerFetchAtEndpointMock).not.toHaveBeenCalled();
    });
});
