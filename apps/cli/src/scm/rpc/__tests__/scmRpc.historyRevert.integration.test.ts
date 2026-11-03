import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { SCM_OPERATION_ERROR_CODES } from '@happier-dev/protocol';
import { createGitWorkspace, createTestRpcManager, runGit as git } from './testRpcHarness';

describe('git RPC handlers', () => {
    it('lists incoming commits from the configured upstream without treating them as current-branch history', async () => {
        const workspace = createGitWorkspace('happier-git-incoming-rpc-');
        writeFileSync(join(workspace, 'a.txt'), 'base\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'base']);
        const baseSha = git(workspace, ['rev-parse', 'HEAD']);
        git(workspace, ['checkout', '-b', 'incoming-source']);
        writeFileSync(join(workspace, 'a.txt'), 'incoming\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'incoming']);
        const incomingSha = git(workspace, ['rev-parse', 'HEAD']);
        git(workspace, ['update-ref', 'refs/remotes/origin/feature', incomingSha]);
        git(workspace, ['checkout', '-b', 'feature', baseSha]);
        git(workspace, ['config', 'branch.feature.remote', 'origin']);
        git(workspace, ['config', 'branch.feature.merge', 'refs/heads/feature']);
        git(workspace, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);

        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd: string; range: 'incoming' }>(RPC_METHODS.SCM_LOG_LIST, {
            cwd: '.', range: 'incoming',
        });
        expect(response.success, JSON.stringify(response)).toBe(true);
        expect(response.rangeApplied).toBe(true);
        expect(response.entries?.map((entry: { sha: string }) => entry.sha)).toEqual([incomingSha]);
    });

    it('preserves commits with empty bodies when listing history', async () => {
        const workspace = createGitWorkspace();

        writeFileSync(join(workspace, 'a.txt'), 'one\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'first']);

        writeFileSync(join(workspace, 'a.txt'), 'two\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'second', '-m', 'second body']);

        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; limit?: number; skip?: number }>(
            RPC_METHODS.SCM_LOG_LIST,
            {
                cwd: '.',
                limit: 2,
                skip: 0,
            },
        );

        expect(response.success).toBe(true);
        expect(response.entries).toHaveLength(2);
        // Protocol timestamps should be UNIX epoch milliseconds (Date.now-compatible).
        // Regression guard: git's `%at` is seconds, so we normalize to ms.
        expect(response.entries[0].timestamp).toBeGreaterThan(1_000_000_000_000);
        expect(response.entries[1].timestamp).toBeGreaterThan(1_000_000_000_000);
        expect(response.entries[0].subject).toBe('second');
        expect(response.entries[0].body).toContain('second body');
        expect(response.entries[1].subject).toBe('first');
        expect(response.entries[1].body).toBe('');
    });

    it('returns a deterministic error when reverting a merge commit', async () => {
        const workspace = createGitWorkspace();

        writeFileSync(join(workspace, 'a.txt'), 'base\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'base']);

        const defaultBranch = git(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']);
        git(workspace, ['checkout', '-b', 'feature']);
        writeFileSync(join(workspace, 'feature.txt'), 'feature\n');
        git(workspace, ['add', 'feature.txt']);
        git(workspace, ['commit', '-m', 'feature']);

        git(workspace, ['checkout', defaultBranch]);
        writeFileSync(join(workspace, 'main.txt'), 'main\n');
        git(workspace, ['add', 'main.txt']);
        git(workspace, ['commit', '-m', 'main']);

        git(workspace, ['merge', '--no-ff', 'feature', '-m', 'merge feature']);
        const mergeSha = git(workspace, ['rev-parse', 'HEAD']);

        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; commit: string }>(RPC_METHODS.SCM_COMMIT_BACKOUT, {
            cwd: '.',
            commit: mergeSha,
        });

        expect(response.success).toBe(false);
        expect(response.errorCode).toBe(SCM_OPERATION_ERROR_CODES.INVALID_REQUEST);
        expect((response.error || '').toLowerCase()).toContain('merge commit');
    }, 20_000);

    it('reverts a regular commit successfully', async () => {
        const workspace = createGitWorkspace();
        writeFileSync(join(workspace, 'a.txt'), 'base\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'base']);
        writeFileSync(join(workspace, 'a.txt'), 'updated\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'feature change']);
        const targetSha = git(workspace, ['rev-parse', 'HEAD']);

        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; commit: string }>(RPC_METHODS.SCM_COMMIT_BACKOUT, {
            cwd: '.',
            commit: targetSha,
        });

        expect(response.success).toBe(true);
        const headSubject = git(workspace, ['log', '-1', '--pretty=%s']);
        expect(headSubject.toLowerCase()).toContain('revert');
        const content = readFileSync(join(workspace, 'a.txt'), 'utf8');
        expect(content).toBe('base\n');
    });

    it('returns NOT_REPOSITORY for commit creation outside a git repository', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-rpc-'));
        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; message: string }>(
            RPC_METHODS.SCM_COMMIT_CREATE,
            {
                cwd: '.',
                message: 'test',
            },
        );

        expect(response.success).toBe(false);
        expect(response.errorCode).toBe(SCM_OPERATION_ERROR_CODES.NOT_REPOSITORY);
    });

    it('returns NOT_REPOSITORY for commit history outside a git repository', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-rpc-'));
        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; limit?: number; skip?: number }>(
            RPC_METHODS.SCM_LOG_LIST,
            {
                cwd: '.',
                limit: 20,
                skip: 0,
            },
        );

        expect(response.success).toBe(false);
        expect(response.errorCode).toBe(SCM_OPERATION_ERROR_CODES.NOT_REPOSITORY);
    });

    it('returns NOT_REPOSITORY for commit revert outside a git repository', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-rpc-'));
        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; commit: string }>(
            RPC_METHODS.SCM_COMMIT_BACKOUT,
            {
                cwd: '.',
                commit: 'HEAD',
            },
        );

        expect(response.success).toBe(false);
        expect(response.errorCode).toBe(SCM_OPERATION_ERROR_CODES.NOT_REPOSITORY);
    });

    it('blocks revert when worktree has local changes', async () => {
        const workspace = createGitWorkspace();
        writeFileSync(join(workspace, 'a.txt'), 'base\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'base']);
        writeFileSync(join(workspace, 'a.txt'), 'dirty\n');

        const sha = git(workspace, ['rev-parse', 'HEAD']);
        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; commit: string }>(RPC_METHODS.SCM_COMMIT_BACKOUT, {
            cwd: '.',
            commit: sha,
        });

        expect(response.success).toBe(false);
        expect(response.errorCode).toBe(SCM_OPERATION_ERROR_CODES.CONFLICTING_WORKTREE);
    });

    it('blocks revert while HEAD is detached', async () => {
        const workspace = createGitWorkspace();
        writeFileSync(join(workspace, 'a.txt'), 'base\n');
        git(workspace, ['add', 'a.txt']);
        git(workspace, ['commit', '-m', 'base']);
        const sha = git(workspace, ['rev-parse', 'HEAD']);
        git(workspace, ['checkout', '--detach']);

        const { call } = createTestRpcManager({ workingDirectory: workspace });
        const response = await call<any, { cwd?: string; commit: string }>(RPC_METHODS.SCM_COMMIT_BACKOUT, {
            cwd: '.',
            commit: sha,
        });

        expect(response.success).toBe(false);
        expect(response.errorCode).toBe(SCM_OPERATION_ERROR_CODES.INVALID_REQUEST);
        expect((response.error || '').toLowerCase()).toContain('detached');
    });
});
