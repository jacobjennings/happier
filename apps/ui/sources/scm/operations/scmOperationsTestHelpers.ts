import { vi } from 'vitest';

import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { mergeScmCapabilities } from '@/scm/core/snapshotMappers';

type ScmOperationsModuleFactory = () => unknown | Promise<unknown>;

type InstallScmOperationsCommonModuleMocksOptions = Readonly<{
    modal?: ScmOperationsModuleFactory;
}>;

const scmOperationsModuleState = vi.hoisted(() => ({
    options: {
        modal: undefined as ScmOperationsModuleFactory | undefined,
    },
}));

/** A clean Git index repository at `/repo` whose backend advertises file include, exclude and discard writes. */
export function createWritableScmSnapshot(overrides: Partial<ScmWorkingSnapshot> = {}): ScmWorkingSnapshot {
    return {
        projectKey: 'machine-1:/repo', fetchedAt: 1, stashCount: 0, hasConflicts: false,
        repo: { isRepo: true, rootPath: '/repo', backendId: 'git' },
        branch: { head: 'main', upstream: 'origin/main', ahead: 0, behind: 0, detached: false },
        capabilities: mergeScmCapabilities({ changeSetModel: 'index', writeInclude: true, writeExclude: true, writeDiscard: true }),
        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
        entries: [],
        ...overrides,
    };
}

export function installScmOperationsCommonModuleMocks(
    options: InstallScmOperationsCommonModuleMocksOptions = {},
) {
    scmOperationsModuleState.options = {
        modal: options.modal,
    };

    vi.mock('@/modal', async () => {
        const activeOptions = scmOperationsModuleState.options;
        if (activeOptions.modal) {
            return await activeOptions.modal();
        }

        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock().module;
    });

    vi.mock('@/text', async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key: string) => key });
    });
}
