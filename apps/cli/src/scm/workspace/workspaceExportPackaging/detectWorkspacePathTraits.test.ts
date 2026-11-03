import { describe, expect, it } from 'vitest';

import { detectWorkspacePathTraits } from './detectWorkspacePathTraits';

describe('detectWorkspacePathTraits', () => {
  it('flags parent traversal and absolute paths', () => {
    expect(detectWorkspacePathTraits('../outside.txt')).toMatchObject({
      hasParentTraversal: true,
      isAbsolute: false,
      isRoot: false,
      normalizedPath: '../outside.txt',
    });

    expect(detectWorkspacePathTraits('/tmp/workspace/file.txt')).toMatchObject({
      hasParentTraversal: false,
      isAbsolute: true,
      normalizedPath: '/tmp/workspace/file.txt',
    });
  });
});
