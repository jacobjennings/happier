import { describe, expect, it } from 'vitest';

import { encodeBase64 } from '@/encryption/base64';
import {
    buildHomeQrInviteDeepLink,
    buildRenderableHomeQrInviteDeepLink,
    buildHomeQrInviteRestoreRoutePath,
    consumeHomeQrInviteRestoreHandoff,
    parseHomeQrInviteDeepLink,
} from './pairingUrl';
import { createQRMatrix } from '@/components/qr/qrMatrix';

const INVITE_BASE = {
    v: 2 as const,
    intent: 'home_device' as const,
    direction: 'trusted_home_displays' as const,
    pairId: 'pair-1',
    home: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
    },
    qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(3), 'base64url'),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
};

describe('HomeQrInviteV2 deep link', () => {
    it('does not admit another Home or the approver direction for pinned material recovery', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(parseHomeQrInviteDeepLink(link, { homeServerIdentityId: 'srv_other', direction: 'trusted_home_displays' })).toBeNull();
        expect(parseHomeQrInviteDeepLink(link, { homeServerIdentityId: INVITE_BASE.home.homeServerIdentityId, direction: 'requester_displays' })).toBeNull();
        expect(parseHomeQrInviteDeepLink(link, { homeServerIdentityId: INVITE_BASE.home.homeServerIdentityId, direction: 'trusted_home_displays' })).toEqual({ invite: INVITE_BASE });
    });
    it('builds one opaque bounded payload carrying the strict invite', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(link).toMatch(/^happier:\/\/\/pair\?v=2&payload=/);
        expect(link).not.toContain('qrSecret');
        expect(link).not.toContain(encodeURIComponent(INVITE_BASE.qrSecretBase64Url));
        expect(link.length).toBeLessThan(4_096);
    });

    it('round-trips the invite through the strict protocol schema', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(parseHomeQrInviteDeepLink(link)).toEqual({ invite: INVITE_BASE });
    });

    it('preserves every Iroh reachability alternative in a renderable invite', () => {
        const fullInvite = {
            ...INVITE_BASE,
            home: {
                ...INVITE_BASE.home,
                canonicalServerUrl: 'http://127.0.0.1:43110',
                endpoints: [
                    {
                        kind: 'iroh' as const,
                        endpointId: 'a'.repeat(64),
                        relayUrls: ['https://relay-1.example.test', 'https://relay-2.example.test'],
                        directAddresses: ['192.0.2.10:443', '192.0.2.11:443'],
                    },
                    { kind: 'https' as const, url: 'https://public.example.test' },
                ],
            },
        };

        const result = buildRenderableHomeQrInviteDeepLink({ invite: fullInvite });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(() => createQRMatrix(result.link, 'medium')).not.toThrow();
        expect(parseHomeQrInviteDeepLink(result.link)?.invite.home).toEqual(fullInvite.home);
    });

    it('returns typed unavailable rather than dropping alternatives from an over-capacity descriptor', () => {
        const longRelayUrls = Array.from({ length: 4 }, (_, index) =>
            `https://relay-${index}.example.test/${'a'.repeat(470)}`,
        );
        const fullInvite = {
            ...INVITE_BASE,
            home: {
                ...INVITE_BASE.home,
                canonicalServerUrl: 'http://127.0.0.1:43110',
                endpoints: [
                    {
                        kind: 'iroh' as const,
                        endpointId: 'a'.repeat(64),
                        relayUrls: longRelayUrls,
                        directAddresses: ['192.0.2.10:443', '192.0.2.11:443'],
                    },
                    { kind: 'https' as const, url: 'https://public.example.test' },
                ],
            },
        };

        const fullLink = buildHomeQrInviteDeepLink({ invite: fullInvite });
        expect(() => createQRMatrix(fullLink, 'medium')).toThrow();
        expect(buildRenderableHomeQrInviteDeepLink({ invite: fullInvite })).toEqual({
            ok: false,
            reason: 'qr_unavailable',
            link: fullLink,
        });
        // The pairing stays live: the exact secret-bearing link still round-trips
        // to the unchanged invite instead of a truncated or re-encoded descriptor.
        expect(parseHomeQrInviteDeepLink(fullLink)?.invite).toEqual(fullInvite);
    });

    it('returns a typed unavailable result instead of throwing when even the minimal legal invite cannot render', () => {
        const fullInvite = {
            ...INVITE_BASE,
            pairId: 'p'.repeat(128),
            home: {
                ...INVITE_BASE.home,
                homeServerIdentityId: `srv_${'h'.repeat(60)}`,
                canonicalServerUrl: `https://home.example.test/${'a'.repeat(480)}`,
                endpoints: [
                    {
                        kind: 'iroh' as const,
                        endpointId: 'b'.repeat(64),
                        relayUrls: [`https://relay.example.test/${'r'.repeat(480)}`],
                        directAddresses: [`[${'1'.repeat(4)}:${'2'.repeat(4)}:${'3'.repeat(4)}:${'4'.repeat(4)}:${'5'.repeat(4)}:${'6'.repeat(4)}:${'7'.repeat(4)}:${'8'.repeat(4)}]:65535`],
                    },
                    { kind: 'https' as const, url: `https://public.example.test/${'u'.repeat(478)}` },
                ],
            },
            requestedDeviceLabel: 'd'.repeat(128),
        };

        const fullLink = buildHomeQrInviteDeepLink({ invite: fullInvite });
        expect(buildRenderableHomeQrInviteDeepLink({ invite: fullInvite })).toEqual({
            ok: false,
            reason: 'qr_unavailable',
            link: fullLink,
        });
        expect(parseHomeQrInviteDeepLink(fullLink)?.invite).toEqual(fullInvite);
    });

    it('returns invalid_invite without a link when the invite cannot be encoded at all', () => {
        const malformed = {
            ...INVITE_BASE,
            qrSecretBase64Url: encodeBase64(new Uint8Array(16), 'base64url'),
        };
        expect(() => buildHomeQrInviteDeepLink({ invite: malformed })).toThrow();
        expect(buildRenderableHomeQrInviteDeepLink({ invite: malformed })).toEqual({
            ok: false,
            reason: 'invalid_invite',
        });
    });

    it('routes a validated invite with only a non-secret handoff handle and caller-selected intent', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        const addHomeRoute = buildHomeQrInviteRestoreRoutePath(link, 'add_home');
        const addHomeHandle = new URL(addHomeRoute!, 'https://app.example.test').searchParams.get('pairingHandoff');
        expect(consumeHomeQrInviteRestoreHandoff(addHomeHandle!)).toBe(link);
        expect(consumeHomeQrInviteRestoreHandoff(addHomeHandle!)).toBeNull();
        const enterHomeRoute = buildHomeQrInviteRestoreRoutePath(link, 'enter_home');
        expect(addHomeRoute).toMatch(/^\/restore\?pairingHandoff=[A-Za-z0-9_-]+&entryIntent=add_home$/u);
        expect(enterHomeRoute).toMatch(/^\/restore\?pairingHandoff=[A-Za-z0-9_-]+&entryIntent=enter_home$/u);
        expect(addHomeRoute).not.toContain(encodeURIComponent(link));
        expect(addHomeRoute).not.toContain(INVITE_BASE.qrSecretBase64Url);
        expect(addHomeRoute).not.toContain('pairingLink=');
        const enterHomeHandle = new URL(enterHomeRoute!, 'https://app.example.test').searchParams.get('pairingHandoff');
        expect(consumeHomeQrInviteRestoreHandoff(enterHomeHandle!)).toBe(link);
        expect(buildHomeQrInviteRestoreRoutePath('happier:///pair?v=1&pairId=p&secret=s', 'enter_home')).toBeNull();
    });

    it('rejects v=2 links with extra query parameters', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(parseHomeQrInviteDeepLink(`${link}&secret=leaked`)).toBeNull();
        expect(parseHomeQrInviteDeepLink(`${link}&pairId=x`)).toBeNull();
    });

    it('rejects oversized payloads', () => {
        const oversized = encodeBase64(new TextEncoder().encode(JSON.stringify({
            ...INVITE_BASE,
            pairId: 'p'.repeat(8_000),
        })), 'base64url');
        expect(parseHomeQrInviteDeepLink(`happier:///pair?v=2&payload=${oversized}`)).toBeNull();
    });

    it('rejects malformed payload bytes and schema-invalid invites', () => {
        expect(parseHomeQrInviteDeepLink('happier:///pair?v=2&payload=!!!not-base64!!!')).toBeNull();
        const manualPayloadLink = (value: unknown): string =>
            `happier:///pair?v=2&payload=${encodeURIComponent(encodeBase64(new TextEncoder().encode(JSON.stringify(value)), 'base64url'))}`;
        expect(parseHomeQrInviteDeepLink(manualPayloadLink({ v: 2 }))).toBeNull();
        // Wrong qrSecret length must fail the schema.
        expect(parseHomeQrInviteDeepLink(manualPayloadLink({
            ...INVITE_BASE,
            qrSecretBase64Url: encodeBase64(new Uint8Array(16), 'base64url'),
        }))).toBeNull();
        // Unsupported intent must fail the schema.
        expect(parseHomeQrInviteDeepLink(manualPayloadLink({
            ...INVITE_BASE,
            intent: 'something_else',
        }))).toBeNull();
        // Building from an invalid invite fails closed instead of emitting a link.
        expect(() => buildHomeQrInviteDeepLink({
            invite: { ...INVITE_BASE, qrSecretBase64Url: encodeBase64(new Uint8Array(16), 'base64url') },
        })).toThrow();
        // Unbounded invite lifetime must fail client-side TTL validation.
        const endless = { ...INVITE_BASE, expiresAtMs: INVITE_BASE.issuedAtMs + 24 * 60 * 60 * 1000 };
        expect(parseHomeQrInviteDeepLink(manualPayloadLink(endless))).toBeNull();
        expect(() => buildHomeQrInviteDeepLink({ invite: endless })).toThrow();
    });

    it('rejects non-pair routes and wrong versions', () => {
        const payload = encodeBase64(new TextEncoder().encode(JSON.stringify(INVITE_BASE)), 'base64url');
        expect(parseHomeQrInviteDeepLink(`happier:///other?v=2&payload=${payload}`)).toBeNull();
        expect(parseHomeQrInviteDeepLink(`happier:///pair?v=1&payload=${payload}`)).toBeNull();
        // A released V1 link must not be mistaken for a V2 invite.
        expect(parseHomeQrInviteDeepLink('happier:///pair?v=1&pairId=p&secret=s')).toBeNull();
        expect(parseHomeQrInviteDeepLink('happier:///pair?v=2')).toBeNull();
    });
});
