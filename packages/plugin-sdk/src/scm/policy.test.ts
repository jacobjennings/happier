import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildWorktreeRelativePath, normalizeWorktreeDisplayName, hasForbiddenGitRefName } from '@happier-dev/plugin-sdk/scm';
import { resolveScmBackendCapabilities, ScmBackendCapabilitiesSchema } from '@happier-dev/plugin-sdk/scm/backend';

describe('shared SCM policy', () => {
    it('projects unavailable capability groups while preserving declared exclusions and freshness', () => {
        const declared = ScmBackendCapabilitiesSchema.parse({
            detection: { repository: { support: 'supported' }, executable: { support: 'supported' } },
            read: { status: { support: 'experimental' } },
            changeSet: { model: 'index', diffAreas: ['both'], include: { support: 'supported' } },
            commit: { create: { support: 'supported' } },
            remote: { push: { support: 'unsupported', reason: 'not_implemented' } },
            branch: { create: { support: 'supported' } },
            worktree: { create: { support: 'supported' } },
            lifecycle: { init: { support: 'supported' } },
            hosting: { pullRequestRead: { support: 'supported' } },
            checkpoints: { capture: { support: 'supported' } },
            workspaceIntegration: { inspectLocation: { support: 'supported' } },
            tooling: { binarySafe: { support: 'supported' } },
            freshness: { state: { source: 'cached-local', observedAt: 1 } },
        });
        const resolved = resolveScmBackendCapabilities({ declaredCapabilities: declared, mode: '.sl', executableAvailable: false });
        expect(resolved.detection.repository?.reason).toBe('repo_mode_unsupported');
        expect(resolved.detection.executable?.reason).toBe('tool_missing');
        expect(resolved.read.status).toEqual({ support: 'unsupported', reason: 'tool_missing', declaredSupport: 'experimental' });
        for (const leaf of [resolved.changeSet.include, resolved.commit.create, resolved.branch.create, resolved.worktree.create,
            resolved.lifecycle.init, resolved.hosting.pullRequestRead, resolved.checkpoints.capture,
            resolved.workspaceIntegration.inspectLocation, resolved.tooling.binarySafe]) {
            expect(leaf).toEqual({ support: 'unsupported', reason: 'tool_missing', declaredSupport: 'supported' });
        }
        expect(resolved.remote.push).toEqual(declared.remote.push);
        expect(resolved.freshness).toEqual(declared.freshness);
        expect(declared.read.status?.support).toBe('experimental');

        const observed = resolveScmBackendCapabilities({
            declaredCapabilities: declared,
            mode: '.git',
            freshness: { state: { source: 'live-local', observedAt: 100 }, refreshPolicy: 'cache-first' },
        });
        expect(observed.freshness).toEqual({ state: { source: 'live-local', observedAt: 100 }, refreshPolicy: 'cache-first' });
        expect(declared.freshness).toEqual({ state: { source: 'cached-local', observedAt: 1 } });
    });

    it('uses the preview convention for native targets and rejects forbidden nested names', () => {
        const name = normalizeWorktreeDisplayName(' feature\\ auth..fix / nested ');
        expect(name).toBe('feature/auth-fix/nested');
        expect(join('/repo', ...buildWorktreeRelativePath(name).split('/'))).toBe('/repo/.dev/worktree/feature/auth-fix/nested');
        expect(hasForbiddenGitRefName('feature/inner.lock')).toBe(true);
        expect(hasForbiddenGitRefName(name)).toBe(false);
    });
});
