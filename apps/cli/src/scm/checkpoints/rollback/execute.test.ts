import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { executeCheckpointCodeRollback } from './execute';
import {
    applyGitCheckpointReversePatch,
    createGitRollbackBackup,
    createGitRollbackStash,
} from './gitCheckpointRollbackOperations';
import { buildGitCheckpointRollbackScopeId } from './gitCheckpointRollbackScope';
import type { CheckpointRollbackOrchestrationDependencies } from './types';
import { captureGitRepositoryCheckpoint } from '../gitRepositoryCheckpointOperations';
import { buildRepositoryCheckpointRefs } from '../refs';
import type { ScmBackendContext } from '../../types';

const baseRequest = {
    v: 1,
    sessionId: 'session-1',
    turnId: 'turn-1',
    cwd: '/repo',
    expectedStartRef: 'refs/happier/checkpoints/c2Vzc2lvbi0x/turn-start/turn-1',
    expectedFinalRef: 'refs/happier/checkpoints/c2Vzc2lvbi0x/turn-final/turn-1',
} as const;

describe('executeCheckpointCodeRollback', () => {
    it('rejects conversation-composition modes before code rollback mutation dependencies run', async () => {
        const captureBackup: CheckpointRollbackOrchestrationDependencies['captureBackup'] = vi.fn(async () => ({
            success: true as const,
            backupCheckpointRef: 'refs/happier/checkpoints/c2Vzc2lvbi0x/rollback-backup/rollback-1',
            receipts: ['checkpoint.rollback_backup_captured' as const],
        }));
        const createStash: NonNullable<CheckpointRollbackOrchestrationDependencies['createStash']> = vi.fn(async () => ({
            success: true as const,
            gitStashRef: 'stash@{0}',
        }));
        const applyReversePatch: CheckpointRollbackOrchestrationDependencies['applyReversePatch'] = vi.fn(async () => ({
            status: 'applied' as const,
            changedPaths: [],
            skippedPaths: [],
            receipts: ['checkpoint.rollback_applied' as const],
            diagnostics: [],
        }));

        const result = await executeCheckpointCodeRollback({
            request: {
                ...baseRequest,
                codeMode: 'conversation_and_code_with_stash',
                backupMode: 'happier_checkpoint_and_git_stash',
            },
            conversationRollbackSupported: true,
            deps: {
                captureBackup,
                createStash,
                applyReversePatch,
            },
        });

        expect(result.status).toBe('unavailable');
        expect(result.diagnostics).toContain('checkpoint_code_rollback_requires_code_only_mode');
        expect(captureBackup).not.toHaveBeenCalled();
        expect(createStash).not.toHaveBeenCalled();
        expect(applyReversePatch).not.toHaveBeenCalled();
    });

    it('stops before stash and reverse patch when backup capture fails', async () => {
        const createStash = vi.fn();
        const applyReversePatch = vi.fn();

        const result = await executeCheckpointCodeRollback({
            request: {
                ...baseRequest,
                codeMode: 'code_only_with_stash',
                backupMode: 'happier_checkpoint_and_git_stash',
                codeOnlyTranscriptDivergenceConfirmed: true,
            },
            conversationRollbackSupported: true,
            deps: {
                captureBackup: async () => ({ success: false, diagnostics: ['capture_failed'] }),
                createStash,
                applyReversePatch,
            },
        });

        expect(result.status).toBe('unavailable');
        expect(result.receipts).toEqual(['checkpoint.rollback_aborted']);
        expect(createStash).not.toHaveBeenCalled();
        expect(applyReversePatch).not.toHaveBeenCalled();
    });

    it('stops before reverse patch when optional stash fails', async () => {
        const applyReversePatch = vi.fn();

        const result = await executeCheckpointCodeRollback({
            request: {
                ...baseRequest,
                codeMode: 'code_only_with_stash',
                backupMode: 'happier_checkpoint_and_git_stash',
                codeOnlyTranscriptDivergenceConfirmed: true,
            },
            conversationRollbackSupported: false,
            deps: {
                captureBackup: async () => ({
                    success: true,
                    backupCheckpointRef: 'refs/happier/checkpoints/c2Vzc2lvbi0x/rollback-backup/rollback-1',
                    receipts: ['checkpoint.rollback_backup_captured'],
                }),
                createStash: async () => ({ success: false, diagnostics: ['stash_failed'] }),
                applyReversePatch,
            },
        });

        expect(result.status).toBe('aborted');
        expect(result.backupCheckpointRef).toContain('/rollback-backup/');
        expect(result.receipts).toEqual(['checkpoint.rollback_backup_captured', 'checkpoint.rollback_aborted']);
        expect(applyReversePatch).not.toHaveBeenCalled();
    });

    it('returns applied result with backup receipt before applied receipt', async () => {
        const result = await executeCheckpointCodeRollback({
            request: {
                ...baseRequest,
                codeMode: 'code_only_without_stash',
                backupMode: 'happier_checkpoint_only',
                codeOnlyTranscriptDivergenceConfirmed: true,
            },
            conversationRollbackSupported: true,
            deps: {
                captureBackup: async () => ({
                    success: true,
                    backupCheckpointRef: 'refs/happier/checkpoints/c2Vzc2lvbi0x/rollback-backup/rollback-1',
                    receipts: ['checkpoint.rollback_backup_captured'],
                }),
                applyReversePatch: async () => ({
                    status: 'applied',
                    changedPaths: ['tracked.txt'],
                    skippedPaths: [],
                    receipts: ['checkpoint.rollback_applied'],
                    diagnostics: [],
                }),
            },
        });

        expect(result).toMatchObject({
            status: 'applied',
            changedPaths: ['tracked.txt'],
            receipts: ['checkpoint.rollback_backup_captured', 'checkpoint.rollback_applied'],
        });
    });

    it('applies a code-only rollback on real Git through the backup, stash and reverse-patch operations', async () => {
        // Git is the only process boundary; planning, orchestration and the rollback operations are real.
        const repoRoot = mkdtempSync(join(tmpdir(), 'happier-checkpoint-rollback-applied-'));
        try {
            execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
            execFileSync('git', ['config', 'user.email', 'checkpoint@happier.dev'], { cwd: repoRoot });
            execFileSync('git', ['config', 'user.name', 'Happier Checkpoint Test'], { cwd: repoRoot });
            writeFileSync(join(repoRoot, 'tracked.txt'), 'base\n', 'utf8');
            execFileSync('git', ['add', 'tracked.txt'], { cwd: repoRoot });
            execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, stdio: 'ignore' });
            const context: ScmBackendContext = {
                cwd: repoRoot,
                projectKey: `test:${repoRoot}`,
                detection: { isRepo: true, rootPath: repoRoot, mode: '.git' },
            };
            const refs = buildRepositoryCheckpointRefs({
                scopeId: buildGitCheckpointRollbackScopeId({ repoRoot, sessionId: 'session-1' }),
                turnId: 'turn-1',
            });
            if (!refs.turnStart || !refs.turnFinal) throw new Error('Missing turn checkpoint refs');
            expect((await captureGitRepositoryCheckpoint({ context, checkpointRef: refs.turnStart })).success).toBe(true);
            writeFileSync(join(repoRoot, 'tracked.txt'), 'changed by turn\n', 'utf8');
            expect((await captureGitRepositoryCheckpoint({ context, checkpointRef: refs.turnFinal })).success).toBe(true);

            const rollbackId = 'rollback-1';
            const result = await executeCheckpointCodeRollback({
                request: {
                    v: 1,
                    sessionId: 'session-1',
                    turnId: 'turn-1',
                    cwd: repoRoot,
                    codeMode: 'code_only_with_stash',
                    backupMode: 'happier_checkpoint_and_git_stash',
                    expectedStartRef: refs.turnStart.ref,
                    expectedFinalRef: refs.turnFinal.ref,
                    codeOnlyTranscriptDivergenceConfirmed: true,
                },
                conversationRollbackSupported: true,
                deps: {
                    captureBackup: async ({ request }) => await createGitRollbackBackup({ context, request, rollbackId }),
                    createStash: async ({ request }) => await createGitRollbackStash({ context, request, rollbackId }),
                    applyReversePatch: async ({ request, backupCaptured }) =>
                        await applyGitCheckpointReversePatch({ context, request, backupCaptured }),
                },
            });

            expect(result).toMatchObject({
                status: 'applied',
                changedPaths: ['tracked.txt'],
                receipts: ['checkpoint.rollback_backup_captured', 'checkpoint.rollback_applied'],
                diagnostics: [],
            });
            expect(readFileSync(join(repoRoot, 'tracked.txt'), 'utf8')).toBe('base\n');
            expect(result.backupCheckpointRef).toContain('/rollback-backup/');
            const backupTree = execFileSync('git', ['rev-parse', `${result.backupCheckpointRef}^{tree}`], { cwd: repoRoot, encoding: 'utf8' }).trim();
            expect(backupTree).toBe(execFileSync('git', ['rev-parse', `${refs.turnFinal.ref}^{tree}`], { cwd: repoRoot, encoding: 'utf8' }).trim());
            expect(result.gitStashRef).toBe('stash@{0}');
            expect(execFileSync('git', ['show', `${result.gitStashRef}:tracked.txt`], { cwd: repoRoot, encoding: 'utf8' })).toBe('changed by turn\n');
        } finally {
            rmSync(repoRoot, { recursive: true, force: true });
        }
    });
});
