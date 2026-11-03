import { describe, expect, it } from 'vitest';

import {
    computeLineContentHash,
    normalizeLineContentForHash,
} from './lineContentHash';

describe('lineContentHash', () => {
    it('changes when line content changes, including whitespace', () => {
        expect(computeLineContentHash('const value = 1;')).not.toBe(computeLineContentHash('const value = 2;'));
        expect(computeLineContentHash('const value = 1;')).not.toBe(computeLineContentHash('  const value = 1;'));
    });

    it('normalizes newline encodings without trimming meaningful line content', () => {
        expect(normalizeLineContentForHash('hello\r\n')).toBe('hello\n');
        expect(normalizeLineContentForHash('hello  ')).toBe('hello  ');
    });
});
