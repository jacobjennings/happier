import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    SCM_OPERATION_ERROR_CODES,
    type ScmRepositoryRemoveIndexLockRequest,
    type ScmRepositoryRemoveIndexLockResponse,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, expect, it } from 'vitest';

import { createTestRpcManager, runGit } from './testRpcHarness';

function confirmedRequest(cwd: string): ScmRepositoryRemoveIndexLockRequest {
    return {
        cwd,
        confirmed: true,
        confirmationToken: 'remove-stale-index-lock',
    };
}

describe('git RPC handlers (remove index lock)', () => {
    it('removes an authorized repository index.lock through the canonical SCM RPC', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-remove-index-lock-rpc-'));
        runGit(workspace, ['init']);
        const lockPath = join(workspace, '.git', 'index.lock');
        writeFileSync(lockPath, 'stale lock');
        const { call } = createTestRpcManager({
            workingDirectory: workspace,
            accessPolicy: { kind: 'restrictedRoots', roots: [workspace] },
        });

        const response = await call<ScmRepositoryRemoveIndexLockResponse, ScmRepositoryRemoveIndexLockRequest>(
            RPC_METHODS.SCM_REPOSITORY_REMOVE_INDEX_LOCK,
            confirmedRequest(workspace),
        );

        expect(response).toMatchObject({
            success: true,
            removed: true,
            reason: 'removed',
        });
        expect(existsSync(lockPath)).toBe(false);
    });

    it('rejects unauthorized cwd before attempting unlink', async () => {
        const suiteDir = mkdtempSync(join(tmpdir(), 'happier-git-remove-index-lock-rpc-'));
        const workspace = join(suiteDir, 'workspace');
        const outside = join(suiteDir, 'outside');
        mkdirSync(workspace, { recursive: true });
        mkdirSync(outside, { recursive: true });
        runGit(outside, ['init']);
        const outsideLock = join(outside, '.git', 'index.lock');
        writeFileSync(outsideLock, 'do not remove');
        const { call } = createTestRpcManager({
            workingDirectory: workspace,
            accessPolicy: { kind: 'restrictedRoots', roots: [workspace] },
        });

        const response = await call<ScmRepositoryRemoveIndexLockResponse, ScmRepositoryRemoveIndexLockRequest>(
            RPC_METHODS.SCM_REPOSITORY_REMOVE_INDEX_LOCK,
            confirmedRequest(outside),
        );

        expect(response).toMatchObject({
            success: false,
            errorCode: SCM_OPERATION_ERROR_CODES.INVALID_PATH,
        });
        expect(existsSync(outsideLock)).toBe(true);
    });

    it('reports Sapling as unsupported for index-lock removal without unlinking', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-remove-index-lock-rpc-'));
        runGit(workspace, ['init']);
        const lockPath = join(workspace, '.git', 'index.lock');
        writeFileSync(lockPath, 'do not remove');
        const { call } = createTestRpcManager({ workingDirectory: workspace });

        const response = await call<ScmRepositoryRemoveIndexLockResponse, ScmRepositoryRemoveIndexLockRequest>(
            RPC_METHODS.SCM_REPOSITORY_REMOVE_INDEX_LOCK,
            {
                ...confirmedRequest(workspace),
                backendPreference: {
                    kind: 'prefer',
                    backendId: 'sapling',
                },
            },
        );

        // With `sl` installed the Sapling backend owns the explicit preference and has no index-lock method;
        // without it the Sapling detector is inapplicable, Git is selected and the preference is unavailable.
        const saplingInstalled = spawnSync('sl', ['--version'], { stdio: 'ignore' }).error == null;
        expect(response).toMatchObject({
            success: false,
            errorCode: saplingInstalled
                ? SCM_OPERATION_ERROR_CODES.FEATURE_UNSUPPORTED
                : SCM_OPERATION_ERROR_CODES.BACKEND_UNAVAILABLE,
        });
        expect(existsSync(lockPath)).toBe(true);
    });
});
