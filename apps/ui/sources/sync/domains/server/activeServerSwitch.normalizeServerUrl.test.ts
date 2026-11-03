import { describe, it, expect } from 'vitest';
import { isSameServerUrl } from './activeServerSwitch';

// normalizeServerUrl is an alias of canonicalizeServerUrl; its rows live in url/serverUrlCanonical.test.ts.
describe('isSameServerUrl', () => {
    it('treats equivalent loopback hosts as the same server and never matches an unusable address', () => {
        expect(isSameServerUrl('http://127.0.0.1:3012', 'http://localhost:3012')).toBe(true);
        expect(isSameServerUrl('http://qa-stack.localhost:3012', 'http://127.0.0.1:3012')).toBe(true);
        expect(isSameServerUrl('http://localhost:3012', 'http://localhost:3013')).toBe(false);
        expect(isSameServerUrl('', '')).toBe(false);
        expect(isSameServerUrl('not a url', 'not a url')).toBe(false);
    });
});
