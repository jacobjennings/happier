import { afterEach, describe, expect, it, vi } from 'vitest';

// The Expo app config is the platform boundary that declares this build's URL scheme.
const appConfig = vi.hoisted(() => ({ scheme: undefined as string | string[] | undefined }));
vi.mock('expo-constants', () => ({
    default: { get expoConfig() { return { scheme: appConfig.scheme }; } },
}));

import { buildAccountConnectRoutePath, parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { classifyLegacyPairingDeepLink } from '@/auth/pairing/pairingUrl';
import { isAcceptedHappierUrlProtocol, resolveAppUrlProtocol } from './appScheme';

describe('Happier app URL scheme', () => {
    afterEach(() => {
        appConfig.scheme = undefined;
    });

    it('accepts every first-party Happier scheme and rejects foreign schemes', () => {
        appConfig.scheme = 'happier-dev';
        for (const protocol of ['happier:', 'happier-dev:', 'happier-internaldev:', 'happier-custom:', 'HAPPIER:']) {
            expect(isAcceptedHappierUrlProtocol(protocol)).toBe(true);
        }
        expect(isAcceptedHappierUrlProtocol('otherapp:')).toBe(false);
        expect(isAcceptedHappierUrlProtocol('')).toBe(false);
    });

    it('accepts and builds with exactly the locally configured custom scheme', () => {
        expect(isAcceptedHappierUrlProtocol('my-team-app:')).toBe(false);
        expect(resolveAppUrlProtocol()).toBe('happier:');

        appConfig.scheme = ['My-Team-App', 'happier-dev'];
        expect(isAcceptedHappierUrlProtocol('my-team-app:')).toBe(true);
        expect(resolveAppUrlProtocol()).toBe('my-team-app:');
    });

    it('gates the account-connect and legacy pairing link parsers on the accepted schemes', () => {
        appConfig.scheme = 'my-team-app';
        expect(parseAccountConnectDeepLink('happier-dev:///account?abc123')).toEqual({ publicKeyB64Url: 'abc123' });
        expect(parseAccountConnectDeepLink('my-team-app:///account?abc123')).toEqual({ publicKeyB64Url: 'abc123' });
        expect(parseAccountConnectDeepLink('otherapp:///account?abc123')).toBeNull();
        expect(buildAccountConnectRoutePath({ publicKeyB64Url: 'abc+123/=' })).toBe(
            '/account?accountConnectKey=abc%2B123%2F%3D',
        );

        const legacyLink = 'pair?v=1&pairId=pid123&secret=sec_abc&server=https%3A%2F%2Fstack.example.test';
        expect(classifyLegacyPairingDeepLink(`happier-internaldev:///${legacyLink}`))
            .toEqual({ kind: 'legacy_pairing_update_required' });
        expect(classifyLegacyPairingDeepLink(`my-team-app:///${legacyLink}`))
            .toEqual({ kind: 'legacy_pairing_update_required' });
        expect(classifyLegacyPairingDeepLink(`otherapp:///${legacyLink}`)).toBeNull();
    });
});
