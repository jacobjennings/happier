import { describe, expect, it } from 'vitest';

import { authProviderRegistry, getAuthProvider } from './registry';

// The registry holds no module state (a frozen built-in list, no cache), so one module instance serves the file.
describe('auth providers registry (fallback)', () => {
    it('returns null for blank provider ids', () => {
        expect(getAuthProvider('')).toBeNull();
        expect(getAuthProvider('   ')).toBeNull();
    });

    it('maps the full current descriptor presentation onto unknown providers', () => {
        const okta = getAuthProvider('okta', {
            displayName: 'Acme Okta',
            badgeIconName: 'shield-outline',
            connectButtonColor: '#123456',
            supportsProfileBadge: true,
        });

        expect(okta).toBeTruthy();
        expect(okta?.id).toBe('okta');
        expect(okta?.displayName).toBe('Acme Okta');
        expect(okta?.badgeIconName).toBe('shield-outline');
        expect(okta?.connectButtonColor).toBe('#123456');
        expect(okta?.supportsProfileBadge).toBe(true);
    });

    it('keeps dynamic providers badge-free when the descriptor has no presentation metadata', () => {
        const provider = getAuthProvider('okta', { displayName: 'Acme Okta' });

        expect(provider?.displayName).toBe('Acme Okta');
        expect(provider?.badgeIconName).toBeUndefined();
        expect(provider?.connectButtonColor).toBeUndefined();
        expect(provider?.supportsProfileBadge).toBe(false);
    });

    it('does not cache dynamic presentation across endpoint observations', () => {
        const first = getAuthProvider('OKTA', { displayName: 'First', badgeIconName: 'one' });
        const second = getAuthProvider('okta', { displayName: 'Second', badgeIconName: 'two' });
        expect(first).not.toBe(second);
        expect(first?.displayName).toBe('First');
        expect(first?.badgeIconName).toBe('one');
        expect(second?.displayName).toBe('Second');
        expect(second?.badgeIconName).toBe('two');
    });

    it('keeps the built-in contribution when a descriptor matches a built-in id', () => {
        const builtIn = authProviderRegistry[0];
        expect(builtIn?.id).toBe('github');

        const resolved = getAuthProvider('GitHub', {
            displayName: 'Impostor',
            badgeIconName: 'impostor',
            connectButtonColor: '#000000',
            supportsProfileBadge: false,
        });
        expect(resolved).toBe(builtIn);
    });

    it('falls back to capitalized provider id when UI metadata is missing', () => {
        const provider = getAuthProvider('customsso');
        expect(provider?.displayName).toBe('Customsso');
    });
});
