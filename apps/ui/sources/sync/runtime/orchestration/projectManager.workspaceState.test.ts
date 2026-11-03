import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

import { projectManager } from './projectManager';

function createSession(id: string, machineId: string, path: string) {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            machineId,
            path,
            host: 'h',
            version: '1',
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: 'online' as const,
    };
}

describe('projectManager workspace-scoped SCM state', () => {
    beforeEach(() => {
        projectManager.clear();
    });

    it('publishes only real snapshot changes through every writer and clears/removals, until demand ends', () => {
        const scope = { serverId: 's', machineId: 'm1', rootPath: '/repo' };
        const snapshot: ScmWorkingSnapshot = {
            projectKey: 'runtime-only', fetchedAt: 1,
            repo: { isRepo: true, rootPath: '/repo' },
            branch: { head: 'feature', upstream: null, ahead: 0, behind: 0, detached: false },
            hasConflicts: false, entries: [], totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0,
                includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
        };
        const branches: (string | null)[] = [];
        const stop = projectManager.subscribeScmSnapshots(() => {
            branches.push(projectManager.getWorkspaceScmSnapshot(scope)?.branch.head ?? null);
        });
        onTestFinished(stop);
        projectManager.updateWorkspaceScmSnapshot(scope, null);
        expect(branches).toEqual([]);
        projectManager.updateWorkspaceScmSnapshot(scope, snapshot);
        projectManager.updateWorkspaceScmSnapshot(scope, { ...snapshot, fetchedAt: 2 });
        expect(branches).toEqual(['feature']);
        projectManager.addSession(createSessionFixture({ id: 's1', metadata: { machineId: 'm1', path: '/repo', host: 'h' } }), { serverId: 's' });
        const projectId = projectManager.getProjectForWorkspace(scope)!.id;
        const onBranch = (head: string) => ({ ...snapshot, branch: { ...snapshot.branch, head } });
        projectManager.updateSessionProjectScmSnapshot('s1', onBranch('session'));
        projectManager.updateProjectScmSnapshot(scope, onBranch('key'));
        projectManager.updateProjectScmSnapshotById(projectId, onBranch('id'));
        projectManager.clearProjectScmStatus(projectId);
        projectManager.updateWorkspaceScmSnapshot(scope, snapshot);
        projectManager.removeSession('s1');
        projectManager.updateWorkspaceScmSnapshot(scope, snapshot);
        projectManager.clear();
        expect(branches).toEqual(['feature', 'session', 'key', 'id', null, 'feature', null, 'feature', null]);
        stop();
        projectManager.updateWorkspaceScmSnapshot(scope, snapshot);
        expect(branches).toHaveLength(9);
    });

    it('tracks touched paths for an explicit workspace even when no session exists', () => {
        const scope = { serverId: 's', machineId: 'm1', rootPath: '/repo' };
        projectManager.markWorkspaceScmTouchedPaths(scope, ['a.ts', 'b.ts'], 10);
        expect(projectManager.getWorkspaceScmTouchedPaths(scope)).toEqual(['a.ts', 'b.ts']);
    });

    it('locks operations per workspace even when no session exists', () => {
        const scope = { serverId: 's', machineId: 'm1', rootPath: '/repo' };
        const started = projectManager.beginWorkspaceScmOperation(scope, 'commit', 100);
        expect(started.started).toBe(true);
        if (!started.started) return;

        expect(projectManager.getWorkspaceScmInFlightOperation(scope)?.operation).toBe('commit');
        expect(projectManager.finishWorkspaceScmOperation(scope, started.operation.id)).toBe(true);
        expect(projectManager.getWorkspaceScmInFlightOperation(scope)).toBeNull();
    });

    it('does not duplicate SCM state between an explicit workspace and a session in the same folder', () => {
        const scope = { serverId: 's', machineId: 'm1', rootPath: '/repo' };
        projectManager.markWorkspaceScmTouchedPaths(scope, ['a.ts'], 10);

        projectManager.addSession(createSession('s1', 'm1', '/repo') as any, { serverId: 's' });
        expect(projectManager.getWorkspaceScmTouchedPathsForSession('s1')).toEqual(['a.ts']);

        projectManager.markWorkspaceScmTouchedPathsForSession('s1', ['b.ts'], 11);
        expect(projectManager.getWorkspaceScmTouchedPaths(scope)).toEqual(['a.ts', 'b.ts']);
    });
});
