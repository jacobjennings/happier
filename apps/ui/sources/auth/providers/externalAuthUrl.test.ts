import { describe, expect, it } from 'vitest';

import { isSafeExternalAuthUrl } from './externalAuthUrl';

describe('isSafeExternalAuthUrl', () => {
    it.each([
        'https://example.test/oauth',
        'happier:///oauth/github',
        // Loopback http stays available for local development.
        'http://localhost:3005/oauth',
        'http://127.0.0.2:3005/oauth',
        'http://auth.localhost:3005/oauth',
        'http://[::1]:3005/oauth',
    ])('accepts %s', (url) => {
        expect(isSafeExternalAuthUrl(url)).toBe(true);
    });

    it.each([
        'javascript:alert(1)',
        'data:text/html,hi',
        'ftp://example.test',
        // Plain http is refused once it leaves this machine.
        'http://example.test/oauth',
        'http://192.168.1.5:3005/oauth',
        '',
        '   ',
    ])('rejects %j', (url) => {
        expect(isSafeExternalAuthUrl(url)).toBe(false);
    });
});
