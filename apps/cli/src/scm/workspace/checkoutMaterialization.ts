import type { ScmWorkspaceIntegrationWorkspaceTransferMetadata } from './workspaceTransfer';

export type ScmWorkspaceIntegrationCheckoutMaterializationRequest = Readonly<{
    targetPath: string;
    sourcePath?: string;
    previousTargetPath?: string;
    workspaceIntegrationMetadata?: ScmWorkspaceIntegrationWorkspaceTransferMetadata;
}>;

export function createScmWorkspaceIntegrationCheckoutMaterializationRequest(input: ScmWorkspaceIntegrationCheckoutMaterializationRequest): ScmWorkspaceIntegrationCheckoutMaterializationRequest {
    return {
        targetPath: input.targetPath,
        sourcePath: input.sourcePath,
        previousTargetPath: input.previousTargetPath,
        workspaceIntegrationMetadata: input.workspaceIntegrationMetadata,
    };
}
