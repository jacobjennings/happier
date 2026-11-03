export type ScmWorkspaceIntegrationWorkspaceCheckoutKind = 'git_worktree';

export type ScmWorkspaceIntegrationWorkspaceCheckoutCreationRequest = Readonly<{
    kind: ScmWorkspaceIntegrationWorkspaceCheckoutKind;
    sourcePath: string;
    displayName: string;
    baseRef: string | null;
    branchMode: 'new' | 'existing';
}>;

export type ScmWorkspaceIntegrationWorkspaceCheckoutCreationResult = Readonly<{
    kind: ScmWorkspaceIntegrationWorkspaceCheckoutKind;
    targetPath: string;
    branchName: string;
    created: boolean;
}>;

export function createScmWorkspaceIntegrationWorkspaceCheckoutCreationRequest(input: Readonly<{
    sourcePath: string;
    checkoutCreation: Readonly<{
        kind: ScmWorkspaceIntegrationWorkspaceCheckoutKind;
        displayName: string;
        baseRef?: string | null;
        branchMode: 'new' | 'existing';
    }>;
}>): ScmWorkspaceIntegrationWorkspaceCheckoutCreationRequest {
    return {
        kind: input.checkoutCreation.kind,
        sourcePath: input.sourcePath,
        displayName: input.checkoutCreation.displayName,
        baseRef: input.checkoutCreation.baseRef ?? null,
        branchMode: input.checkoutCreation.branchMode,
    };
}
