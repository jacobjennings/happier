import { describe, expect, it, vi } from 'vitest';

import { SCM_OPERATION_ERROR_CODES, type ScmOperationOutcome } from '@happier-dev/protocol/scm';

import { installScmOperationsCommonModuleMocks } from './scmOperationsTestHelpers';

const modalConfirm = vi.hoisted(() => vi.fn());

installScmOperationsCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                confirm: modalConfirm,
            },
        }).module;
    },
});

const lockFailure = {
    success: false,
    errorCode: SCM_OPERATION_ERROR_CODES.COMMAND_FAILED,
    error: "fatal: Unable to create '/repo/.git/index.lock': File exists.",
} as const;

describe('runScmOperationWithGitIndexLockRecovery', () => {
    it('offers recovery for the canonical index-lock code without parsing diagnostics', async () => {
        modalConfirm.mockReset().mockResolvedValue(false);
        const { runScmOperationWithGitIndexLockRecovery } = await import('./gitIndexLockRecovery');
        await runScmOperationWithGitIndexLockRecovery({
            cwd: '/repo', failedResponse: { success: false, errorCode: 'INDEX_LOCKED' },
            removeIndexLock: vi.fn(), retryOriginalOperation: vi.fn(),
        });
        expect(modalConfirm).toHaveBeenCalled();
    });
    it('never replays applied or uncertain mutations even when legacy diagnostics mention an index lock', async () => {
        modalConfirm.mockReset().mockResolvedValue(true);
        const removeIndexLock = vi.fn(async () => ({ success: true as const, removed: true, lockPath: '/repo/.git/index.lock' }));
        const retryOriginalOperation = vi.fn(async () => ({ success: true as const }));
        const { runScmOperationWithGitIndexLockRecovery } = await import('./gitIndexLockRecovery');
        const outcomes: ScmOperationOutcome[] = [
            { v: 1, kind: 'effect_applied_with_warning', errorCode: 'INDEX_RECONCILIATION_FAILED', effect: { kind: 'commit', commitSha: 'abc' }, nextActions: [{ kind: 'refresh' }] },
            { v: 1, kind: 'outcome_unknown', errorCode: 'COMMAND_OUTCOME_UNKNOWN', reconciliation: { kind: 'stash' }, nextActions: [{ kind: 'refresh' }] },
        ];
        for (const outcome of outcomes) {
            const failedResponse = { ...lockFailure, outcome };
            expect(await runScmOperationWithGitIndexLockRecovery({ cwd: '/repo', failedResponse, removeIndexLock, retryOriginalOperation })).toBe(failedResponse);
        }
        expect(modalConfirm).not.toHaveBeenCalled();
        expect(removeIndexLock).not.toHaveBeenCalled();
        expect(retryOriginalOperation).not.toHaveBeenCalled();
    });

    it('prompts for confirmation when an SCM failure is recoverable index-lock contention', async () => {
        modalConfirm.mockResolvedValueOnce(false);
        const removeIndexLock = vi.fn();
        const retryOriginalOperation = vi.fn();
        const { runScmOperationWithGitIndexLockRecovery } = await import('./gitIndexLockRecovery');

        const response = await runScmOperationWithGitIndexLockRecovery({
            cwd: '/repo',
            failedResponse: lockFailure,
            removeIndexLock,
            retryOriginalOperation,
        });

        expect(response).toBe(lockFailure);
        expect(modalConfirm).toHaveBeenCalledTimes(1);
        expect(removeIndexLock).not.toHaveBeenCalled();
        expect(retryOriginalOperation).not.toHaveBeenCalled();
    });

    it('confirms, removes the backend-resolved lock, and retries the original operation once', async () => {
        modalConfirm.mockReset();
        modalConfirm.mockResolvedValueOnce(true);
        const retryResponse = { success: true, stdout: 'retried' } as const;
        const removeIndexLock = vi.fn(async () => ({ success: true, removed: true, lockPath: '/repo/.git/index.lock' } as const));
        const retryOriginalOperation = vi.fn(async () => retryResponse);
        const { runScmOperationWithGitIndexLockRecovery } = await import('./gitIndexLockRecovery');

        const response = await runScmOperationWithGitIndexLockRecovery({
            cwd: '/repo',
            failedResponse: lockFailure,
            removeIndexLock,
            retryOriginalOperation,
        });

        expect(response).toBe(retryResponse);
        expect(removeIndexLock).toHaveBeenCalledWith({
            cwd: '/repo',
            confirmed: true,
            confirmationToken: 'remove-stale-index-lock',
        });
        expect(retryOriginalOperation).toHaveBeenCalledTimes(1);
    });

    it('surfaces a distinct error when removeIndexLock itself fails (does not retry)', async () => {
        modalConfirm.mockReset();
        modalConfirm.mockResolvedValueOnce(true);
        const removeIndexLock = vi.fn(async () => ({
            success: false as const,
            errorCode: SCM_OPERATION_ERROR_CODES.COMMAND_FAILED,
            error: 'permission denied: cannot unlink /repo/.git/index.lock',
        }));
        const retryOriginalOperation = vi.fn();
        const { runScmOperationWithGitIndexLockRecovery } = await import('./gitIndexLockRecovery');

        const response = await runScmOperationWithGitIndexLockRecovery({
            cwd: '/repo',
            failedResponse: lockFailure,
            removeIndexLock,
            retryOriginalOperation,
        });

        expect(response.success).toBe(false);
        expect((response as { error?: string }).error).toBe('files.indexLockRecovery.failed');
        expect(retryOriginalOperation).not.toHaveBeenCalled();
    });

    it('does not prompt for non-lock SCM failures', async () => {
        modalConfirm.mockReset();
        const removeIndexLock = vi.fn();
        const retryOriginalOperation = vi.fn();
        const { runScmOperationWithGitIndexLockRecovery } = await import('./gitIndexLockRecovery');

        const response = await runScmOperationWithGitIndexLockRecovery({
            cwd: '/repo',
            failedResponse: {
                success: false,
                errorCode: SCM_OPERATION_ERROR_CODES.REMOTE_REJECTED,
                error: 'remote rejected',
            },
            removeIndexLock,
            retryOriginalOperation,
        });

        expect(response.success).toBe(false);
        expect(modalConfirm).not.toHaveBeenCalled();
        expect(removeIndexLock).not.toHaveBeenCalled();
        expect(retryOriginalOperation).not.toHaveBeenCalled();
    });
});
