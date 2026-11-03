import { describe, expect, it } from 'vitest';

import { scmUiBackendRegistry } from './scmUiBackendRegistry';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

describe('scmUiBackendRegistry', () => {
    it.each([
        { ids: ['git', 'happier.scm.backend.git/git'], displayName: 'Git', modes: ['included', 'pending'] },
        { ids: ['sapling', 'happier.scm.backend.sapling/sapling'], displayName: 'Sapling', modes: ['pending'] },
    ])('resolves $displayName by bare and qualified identity to its leaf UI policy', ({ ids, displayName, modes }) => {
        for (const id of ids) {
            const plugin = scmUiBackendRegistry.getPlugin(id);
            expect(plugin.displayName).toBe(displayName);
            // Conservative without a snapshot so older daemons never get a "both" diff request they cannot satisfy.
            expect(plugin.diffModeConfig(null).availableModes).toEqual(modes);
        }
    });

    it('falls back when backend id is unknown', () => {
        const fallback = scmUiBackendRegistry.getPlugin('unknown');
        expect(fallback.displayName).toBe('Source control');
    });

    it('does not infer branch from head for unknown backends without upstream', () => {
        const fallback = scmUiBackendRegistry.getPlugin('unknown');
        const snapshot = {
            projectKey: 'machine:/repo',
            fetchedAt: 1,
            repo: {
                isRepo: true,
                rootPath: '/repo',
                backendId: 'git-unknown',
                mode: '.git',
            },
            capabilities: {
                readStatus: true,
                readDiffFile: true,
                readDiffCommit: true,
                readLog: true,
                writeInclude: false,
                writeExclude: false,
                writeCommit: true,
                writeCommitPathSelection: true,
                writeCommitLineSelection: false,
                writeBackout: true,
                writeRemoteFetch: true,
                writeRemotePull: true,
                writeRemotePush: true,
                worktreeCreate: false,
                changeSetModel: 'working-copy',
                supportedDiffAreas: ['pending', 'both'],
            },
            branch: {
                head: 'feature/no-upstream',
                upstream: null,
                ahead: 0,
                behind: 0,
                detached: false,
            },
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
            },
        } as unknown as ScmWorkingSnapshot;

        expect(fallback.inferRemoteTarget(snapshot)).toEqual({
            remote: 'origin',
            branch: null,
        });
    });

    it('derives external backend UI policy from the same declared capabilities as first-party backends', () => {
        const fallback = scmUiBackendRegistry.getPlugin('acme.scm/stacked');
        const snapshot = {
            capabilities: {
                writeInclude: false,
                writeExclude: false,
                writeCommitPathSelection: false,
                writeCommitLineSelection: true,
                changeSetModel: 'index',
                supportedDiffAreas: ['both'],
            },
        } as unknown as ScmWorkingSnapshot;

        expect(fallback.mapCapabilitiesToUiPolicy(snapshot)).toEqual({
            supportsIncludeExclude: false,
            supportsLineSelection: true,
            changeSetModel: 'index',
            supportedDiffAreas: ['both'],
        });
        expect(fallback.commitActionConfig(snapshot)).toMatchObject({
            supportsPathScopedCommit: false,
            supportsLineSelection: true,
        });
    });

    it('fails closed for sapling remote actions when capabilities are unavailable', () => {
        const saplingPlugin = scmUiBackendRegistry.getPlugin('sapling');
        const snapshot: ScmWorkingSnapshot = {
            projectKey: 'machine:/repo',
            fetchedAt: 1,
            repo: {
                isRepo: true,
                rootPath: '/repo',
                backendId: 'sapling',
                mode: '.sl',
            },
            branch: {
                head: 'feature/no-upstream',
                upstream: null,
                ahead: 0,
                behind: 0,
                detached: false,
            },
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
            },
        };

        expect(saplingPlugin.remoteActionConfig(snapshot)).toMatchObject({
            fetch: false,
            pull: false,
            push: false,
        });
    });
});
