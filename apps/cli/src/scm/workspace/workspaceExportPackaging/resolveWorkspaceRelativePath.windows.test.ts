import { describe, expect, it, vi } from 'vitest';

// Windows path semantics on any host: path.relative across drives returns the
// absolute target path instead of a `..`-prefixed one.
vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual.win32, posix: actual.posix, win32: actual.win32, default: { ...actual.win32, posix: actual.posix, win32: actual.win32 } };
});

describe('resolveWorkspaceRelativePath on Windows paths', () => {
  it('keeps same-drive paths inside the root and rejects paths on another drive', async () => {
    const { resolveWorkspaceRelativePath } = await import('./resolveWorkspaceRelativePath');
    const workspaceRoot = 'C:\\work\\demo';

    expect(resolveWorkspaceRelativePath({ workspaceRoot, candidatePath: 'C:\\work\\demo\\src\\index.ts' })).toEqual({
      ok: true,
      relativePath: 'src/index.ts',
    });
    expect(resolveWorkspaceRelativePath({ workspaceRoot, candidatePath: 'D:\\outside\\escape.txt' })).toEqual({
      ok: false,
      errorCode: 'workspace_path_outside_root',
    });
  });

  it('rejects a drive-relative symlink target that resolves onto another drive', async () => {
    const { assertWorkspaceMaterializationSymlinkTarget } = await import('../workspaceMaterializationSafety');

    expect(() => assertWorkspaceMaterializationSymlinkTarget({
      workspaceRoot: 'C:\\work\\demo',
      linkPath: 'C:\\work\\demo\\src\\link',
      target: 'D:escape',
    })).toThrow(/symlink target escapes target/);
  });
});
