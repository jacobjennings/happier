import { describe, expect, it } from 'vitest';

import {
    createScmWorkspaceIntegrationWorkspaceTransferRequest,
    createScmWorkspaceIntegrationWorkspaceTransferResult,
} from './workspaceTransfer';

describe('workspaceTransfer', () => {
    it('clones transfer request arrays without sharing ignored-glob state', () => {
        const ignoredIncludeGlobs = ['dist/**'];
        const extraIgnorePatterns = ['coverage/**'];
        const request = createScmWorkspaceIntegrationWorkspaceTransferRequest({
            strategy: 'transfer_snapshot',
            includeIgnoredMode: 'include_selected',
            ignoredIncludeGlobs,
            includeAllIgnored: true,
            extraIgnorePatterns,
        });

        ignoredIncludeGlobs.push('coverage/**');
        extraIgnorePatterns.push('tmp/**');

        expect(request.strategy).toBe('transfer_snapshot');
        expect(request.includeIgnoredMode).toBe('include_selected');
        expect(request.ignoredIncludeGlobs).toEqual(['dist/**']);
        expect(request.includeAllIgnored).toBe(true);
        expect(request.extraIgnorePatterns).toEqual(['coverage/**']);
    });

    it('clones transfer result entries and preserves metadata', () => {
        const entries = [{
            relativePath: '.git/HEAD',
            sourcePath: '/repo/.git/HEAD',
        }];
        const metadata = { branchName: 'main' };
        const result = createScmWorkspaceIntegrationWorkspaceTransferResult({
            entries,
            metadata,
        });

        entries.push({
            relativePath: '.git/config',
            sourcePath: '/repo/.git/config',
        });

        expect(result.entries).toEqual([
            {
                relativePath: '.git/HEAD',
                sourcePath: '/repo/.git/HEAD',
            },
        ]);
        expect(result.metadata).toEqual({
            branchName: 'main',
        });
    });
});
