import { describe, expect, it } from 'vitest';

import { resolveMaxOldSpaceSizeMb, upsertMaxOldSpaceSize } from '../withNodeHeapLimit.mjs';

describe('withNodeHeapLimit', () => {
  it.each([
    { nodeOptions: '', expected: '--max-old-space-size=8192' },
    { nodeOptions: '--trace-warnings', expected: '--trace-warnings --max-old-space-size=8192' },
    { nodeOptions: '--max-old-space-size=2048 --trace-warnings', expected: '--max-old-space-size=2048 --trace-warnings' },
    { nodeOptions: '--trace-warnings --max-old-space-size=4096', expected: '--trace-warnings --max-old-space-size=4096' },
    { nodeOptions: '--max-old-space-size 2048', expected: '--max-old-space-size 2048' },
  ])('upserts the heap limit into NODE_OPTIONS "$nodeOptions" without overriding an existing limit', ({ nodeOptions, expected }) => {
    expect(upsertMaxOldSpaceSize(nodeOptions, 8192)).toBe(expected);
  });

  it('defaults to 8192 when env override is missing/invalid', () => {
    expect(resolveMaxOldSpaceSizeMb({})).toBe(8192);
    expect(resolveMaxOldSpaceSizeMb({ HAPPIER_CLI_TEST_MAX_OLD_SPACE_SIZE_MB: 'nope' })).toBe(8192);
    expect(resolveMaxOldSpaceSizeMb({ HAPPIER_CLI_TEST_MAX_OLD_SPACE_SIZE_MB: '0' })).toBe(8192);
  });

  it('respects HAPPIER_CLI_TEST_MAX_OLD_SPACE_SIZE_MB override when valid', () => {
    expect(resolveMaxOldSpaceSizeMb({ HAPPIER_CLI_TEST_MAX_OLD_SPACE_SIZE_MB: '4096' })).toBe(4096);
  });
});

