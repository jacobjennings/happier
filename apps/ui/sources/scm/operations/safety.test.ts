import { describe, expect, it } from 'vitest';

import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { canRevertFromSnapshot } from './safety';

function makeSnapshot(totals: Partial<ScmWorkingSnapshot['totals']> = {}): ScmWorkingSnapshot {
    return {
        projectKey: 'project',
        fetchedAt: 1,
        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
        capabilities: {
            readStatus: true,
            readDiffFile: true,
            readDiffCommit: true,
            readLog: true,
            writeInclude: true,
            writeExclude: true,
            writeCommit: true,
            writeCommitPathSelection: true,
            writeCommitLineSelection: true,
            writeBackout: true,
            writeRemoteFetch: true,
            writeRemotePull: true,
            writeRemotePush: true,
            worktreeCreate: true,
            operationLabels: { commit: 'Commit staged' },
        },
        branch: { head: 'main', upstream: 'origin/main', ahead: 0, behind: 0, detached: false },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
            ...totals,
        },
    };
}

describe('canRevertFromSnapshot', () => {
    it('allows revert on a clean snapshot and blocks it without a snapshot', () => {
        expect(canRevertFromSnapshot(makeSnapshot())).toBe(true);
        expect(canRevertFromSnapshot(null)).toBe(false);
        expect(canRevertFromSnapshot(undefined)).toBe(false);
    });
});
