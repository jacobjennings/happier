import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldRunPostinstall } = require('../../../../../scripts/postinstall/shouldRunPostinstall.cjs') as {
    shouldRunPostinstall(input: { workspace: string; scope: string }): boolean;
};

describe('shouldRunPostinstall', () => {
    it.each([
        { scope: '', expected: true },
        { scope: 'ui,protocol', expected: false },
        { scope: 'ui,server', expected: true },
        { scope: 'all', expected: true },
    ])('returns $expected for the server workspace when the scope is $scope', ({ scope, expected }) => {
        expect(shouldRunPostinstall({ workspace: 'server', scope })).toBe(expected);
    });
});
