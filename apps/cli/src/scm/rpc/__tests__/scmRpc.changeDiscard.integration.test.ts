import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createGitWorkspace, createTestRpcManager, runGit } from './testRpcHarness';

describe('scm rpc change discard (git)', () => {
    function createCommittedWorkspace(): string {
        const workspace = createGitWorkspace('happier-scm-discard-git-');
        writeFileSync(join(workspace, 'a.txt'), 'base\n');
        runGit(workspace, ['add', 'a.txt']);
        runGit(workspace, ['commit', '-m', 'init']);
        return workspace;
    }

    it('discards pending modifications to a tracked file', async () => {
        const workspace = createCommittedWorkspace();
        writeFileSync(join(workspace, 'a.txt'), 'changed\n');

        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const discard = await call<any, { cwd?: string; entries: Array<{ path: string; kind: string }> }>(
            RPC_METHODS.SCM_CHANGE_DISCARD,
            {
                cwd: '.',
                entries: [{ path: 'a.txt', kind: 'modified' }],
            }
        );

        expect(discard.success).toBe(true);
        expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('base\n');
    });

    it('removes untracked files when discarded', async () => {
        const workspace = createCommittedWorkspace();
        writeFileSync(join(workspace, 'b.txt'), 'tmp\n');

        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const discard = await call<any, { cwd?: string; entries: Array<{ path: string; kind: string }> }>(
            RPC_METHODS.SCM_CHANGE_DISCARD,
            {
                cwd: '.',
                entries: [{ path: 'b.txt', kind: 'untracked' }],
            }
        );

        expect(discard.success).toBe(true);
        const status = await call<any, { cwd?: string }>(RPC_METHODS.SCM_STATUS_SNAPSHOT, { cwd: '.' });
        expect(status.success).toBe(true);
        expect((status.snapshot.entries as Array<{ path: string }>).some((e) => e.path === 'b.txt')).toBe(false);
    });
});

