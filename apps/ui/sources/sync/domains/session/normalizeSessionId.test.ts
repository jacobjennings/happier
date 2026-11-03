import { describe, expect, it } from 'vitest';

import { normalizeSessionId } from './normalizeSessionId';

describe('normalizeSessionId', () => {
    it('trims a plain string id', () => {
        expect(normalizeSessionId('  s1 ')).toBe('s1');
    });

    it('returns the first non-empty trimmed entry of an array id', () => {
        expect(normalizeSessionId(['', 's1'])).toBe('s1');
        expect(normalizeSessionId(['  ', ' s2 ', 's3'])).toBe('s2');
        expect(normalizeSessionId(['s1', 's2'])).toBe('s1');
    });

    it('returns an empty string when no usable id is present', () => {
        expect(normalizeSessionId(undefined)).toBe('');
        expect(normalizeSessionId(null)).toBe('');
        expect(normalizeSessionId('   ')).toBe('');
        expect(normalizeSessionId([])).toBe('');
        expect(normalizeSessionId(['', '  '])).toBe('');
    });

    it('coerces non-string entries the way the route params arrive', () => {
        expect(normalizeSessionId([undefined, 7] as unknown as string[])).toBe('7');
        expect(normalizeSessionId(42 as unknown as string)).toBe('42');
    });
});
