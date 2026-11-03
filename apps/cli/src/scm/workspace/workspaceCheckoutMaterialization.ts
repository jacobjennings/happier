import type { ScmWorkspaceIntegrationWorkspaceCheckoutKind } from './workspaceCheckoutCreation';

export type ScmWorkspaceIntegrationWorkspaceCheckoutMaterializationRequest = Readonly<{
    kind: ScmWorkspaceIntegrationWorkspaceCheckoutKind;
    sourcePath: string;
    targetPath: string;
    displayName: string;
    baseRef: string | null;
    branchMode: 'new' | 'existing';
}>;

export type ScmWorkspaceIntegrationWorkspaceCheckoutMaterializationResult = Readonly<{
    targetPath: string;
    branchName: string;
    created: boolean;
}>;

export function createScmWorkspaceIntegrationWorkspaceCheckoutMaterializationRequest(input: Readonly<{
    sourcePath: string;
    targetPath: string;
    checkoutCreation: Readonly<{
        kind: ScmWorkspaceIntegrationWorkspaceCheckoutKind;
        displayName: string;
        baseRef?: string | null;
        branchMode: 'new' | 'existing';
    }>;
}>): ScmWorkspaceIntegrationWorkspaceCheckoutMaterializationRequest {
    return {
        kind: input.checkoutCreation.kind,
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        displayName: input.checkoutCreation.displayName,
        baseRef: input.checkoutCreation.baseRef ?? null,
        branchMode: input.checkoutCreation.branchMode,
    };
}
