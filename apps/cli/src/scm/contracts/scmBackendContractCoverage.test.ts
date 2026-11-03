import { describe, expect, it } from 'vitest';

import { GIT_SCM_BACKEND_CAPABILITIES } from '@happier-dev/plugins-scm-git';
import type { ScmBackendCapabilityLeafPath } from '@/testkit/scm/scmBackendContractAssertions';
import {
    assertScmBackendContractLeafCoverage,
    scmCapabilityPathKey,
} from '@/testkit/scm/scmBackendContractCoverage';
import { shouldRunScmBackendLeafAccount } from '@/testkit/scm/scmBackendContractHarness';
import { createScmBackendCapabilityLeafAccounts } from '@/testkit/scm/scmBackendContractLeafAccounts';

function pathKey(path: ScmBackendCapabilityLeafPath): string {
    return scmCapabilityPathKey(path);
}

describe('SCM backend contract capability coverage', () => {
    it('marks Sapling unsupported backend-method leaves runnable without sl', () => {
        const accountsByPath = new Map(
            createScmBackendCapabilityLeafAccounts({ repoMode: '.sl' })
                .map((account) => [pathKey(account.path), account]),
        );

        for (const key of [
            'read.fileAtRevision',
            'branch.list',
            'branch.create',
            'branch.checkout',
            'branch.merge',
            'branch.rebase',
            'branch.operationControl',
            'worktree.create',
            'worktree.remove',
            'worktree.prune',
            'hosting.pullRequestRead',
            'hosting.pullRequestCreate',
        ]) {
            const account = accountsByPath.get(key);
            expect(account?.kind, key).toBe('unsupported-method');
            expect(account?.requiresExecutable, key).toBe(false);
            expect(account?.assertUnsupported, key).toBeTypeOf('function');
        }
    });

    it('runs non-executable unsupported-method accounts when the executable is unavailable', () => {
        const accountsByPath = new Map(
            createScmBackendCapabilityLeafAccounts({ repoMode: '.sl' })
                .map((account) => [pathKey(account.path), account]),
        );

        const branchList = accountsByPath.get('branch.list');
        const readStatus = accountsByPath.get('read.status');

        expect(branchList).toBeDefined();
        expect(readStatus).toBeDefined();
        if (!branchList || !readStatus) return;

        expect(shouldRunScmBackendLeafAccount({
            account: branchList,
            executableAvailable: false,
        })).toBe(true);
        expect(shouldRunScmBackendLeafAccount({
            account: readStatus,
            executableAvailable: false,
        })).toBe(false);
    });

    it('fails when a supported grouped capability leaf has no coverage account', () => {
        const accounts = createScmBackendCapabilityLeafAccounts({ repoMode: '.git' })
            .filter((account) => pathKey(account.path) !== 'remote.fetch');

        expect(() => assertScmBackendContractLeafCoverage({
            backendId: 'git',
            capabilities: GIT_SCM_BACKEND_CAPABILITIES,
            accounts,
        })).toThrow(/remote\.fetch/);
    });
});
