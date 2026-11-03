import { isAbsolute, relative, resolve } from 'node:path';

import { detectWorkspacePathTraits } from '@/scm/workspace/workspaceExportPackaging/detectWorkspacePathTraits';

export type ResolveWorkspaceRelativePathResult = Readonly<
  | { ok: true; relativePath: string }
  | { ok: false; errorCode: 'workspace_path_outside_root' }
>;

export function resolveWorkspaceRelativePath(params: Readonly<{
  workspaceRoot: string;
  candidatePath: string;
}>): ResolveWorkspaceRelativePathResult {
  const root = resolve(params.workspaceRoot);
  const absoluteCandidate = isAbsolute(params.candidatePath)
    ? resolve(params.candidatePath)
    : resolve(root, params.candidatePath);
  // On Windows a candidate on another drive yields an absolute relative path.
  const nativeRelativePath = relative(root, absoluteCandidate);
  const traits = detectWorkspacePathTraits(nativeRelativePath);
  if (isAbsolute(nativeRelativePath) || traits.isAbsolute || traits.hasParentTraversal) {
    return { ok: false, errorCode: 'workspace_path_outside_root' };
  }
  return { ok: true, relativePath: traits.normalizedPath };
}
