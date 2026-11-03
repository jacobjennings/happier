import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    SCM_OPERATION_ERROR_CODES,
    type ScmRepositoryInitRequest,
    type ScmRepositoryInitResponse,
    type ScmStatusSnapshotRequest,
    type ScmStatusSnapshotResponse,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, expect, it } from 'vitest';

import { createTestRpcManager, runGit } from './testRpcHarness';

describe('git RPC handlers (repository init)', () => {
    it('advertises repository initialization on authorized non-repository snapshots', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-init-rpc-'));
        const { call } = createTestRpcManager({ workingDirectory: workspace });

        const response = await call<ScmStatusSnapshotResponse, ScmStatusSnapshotRequest>(
            RPC_METHODS.SCM_STATUS_SNAPSHOT,
            { cwd: '.' },
        );

        expect(response.success).toBe(true);
        if (!response.success) {
            throw new Error(response.error);
        }
        const snapshot = response.snapshot;
        expect(snapshot).toBeDefined();
        if (!snapshot) {
            throw new Error('Expected non-repository status snapshot');
        }
        expect(snapshot.repo.isRepo).toBe(false);
        expect(snapshot.entries).toEqual([]);
        expect(snapshot.capabilities.writeRepositoryInit).toBe(true);
    });

    it('initializes an authorized non-repository child path and returns a fresh snapshot', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-init-rpc-'));
        const child = join(workspace, 'project');
        mkdirSync(child, { recursive: true });
        const { call } = createTestRpcManager({
            workingDirectory: workspace,
            accessPolicy: { kind: 'restrictedRoots', roots: [workspace] },
        });

        const response = await call<ScmRepositoryInitResponse, ScmRepositoryInitRequest>(
            RPC_METHODS.SCM_REPOSITORY_INIT,
            { cwd: child, initialBranch: 'main' },
        );

        expect(response.success).toBe(true);
        if (!response.success) {
            throw new Error(response.error);
        }
        expect(response.alreadyInitialized).toBe(false);
        expect(runGit(child, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
        expect(response.snapshot?.repo).toMatchObject({
            isRepo: true,
            backendId: 'git',
            mode: '.git',
        });
        expect(response.snapshot?.repo.rootPath).toBe(runGit(child, ['rev-parse', '--show-toplevel']));
    });

    it('rejects repository init outside the restricted filesystem root', async () => {
        const suiteDir = mkdtempSync(join(tmpdir(), 'happier-git-init-rpc-'));
        const workspace = join(suiteDir, 'workspace');
        const outside = join(suiteDir, 'outside');
        mkdirSync(workspace, { recursive: true });
        mkdirSync(outside, { recursive: true });
        const { call } = createTestRpcManager({
            workingDirectory: workspace,
            accessPolicy: { kind: 'restrictedRoots', roots: [workspace] },
        });

        const response = await call<ScmRepositoryInitResponse, ScmRepositoryInitRequest>(
            RPC_METHODS.SCM_REPOSITORY_INIT,
            { cwd: outside },
        );

        expect(response).toMatchObject({
            success: false,
            errorCode: SCM_OPERATION_ERROR_CODES.INVALID_PATH,
        });
        expect(existsSync(join(outside, '.git'))).toBe(false);
    });
});
