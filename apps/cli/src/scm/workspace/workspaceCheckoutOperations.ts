import { runWithScmBackendRegistryLease } from '../scmBackendCatalog';
import type { ScmBackendRegistry, ScmBackendSelection } from '../registry';
import { resolveScmSelection } from '../resolveScmSelection';
import {
    createScmWorkspaceIntegrationWorkspaceCheckoutCreationRequestFromRealization,
    createScmWorkspaceIntegrationWorkspaceCheckoutMaterializationRequestFromRealization,
    createScmWorkspaceIntegrationWorkspaceCheckoutRealizationRequest,
    createScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult,
    type ScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult,
} from './workspaceCheckoutRealization';
import type {
    ScmBackendContext,
    ScmWorkspaceIntegrationWorkspaceCheckoutMaterializationInput,
} from '../types';

async function realizeWorkspaceCheckoutWithResolvedScmSelection(input: Readonly<{
    sourcePath: string;
    targetPath?: string;
    checkoutCreation: Pick<
        ScmWorkspaceIntegrationWorkspaceCheckoutMaterializationInput['workspaceCheckoutMaterialization'],
        'kind' | 'displayName' | 'baseRef' | 'branchMode'
    >;
    context: ScmBackendContext;
    selection: ScmBackendSelection;
}>): Promise<ScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult | null> {
    const workspaceIntegration = input.selection.backend.workspaceIntegration;
    if (!workspaceIntegration) {
        return null;
    }

    const workspaceCheckoutRealization = createScmWorkspaceIntegrationWorkspaceCheckoutRealizationRequest({
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        checkoutCreation: input.checkoutCreation,
    });
    if (workspaceIntegration.realizeWorkspaceCheckout) {
        return await workspaceIntegration.realizeWorkspaceCheckout({
            context: input.context,
            workspaceCheckoutRealization,
        });
    }

    if (input.targetPath) {
        if (!workspaceIntegration.materializeWorkspaceCheckout) {
            return null;
        }

        const materialized = await workspaceIntegration.materializeWorkspaceCheckout({
            context: input.context,
            workspaceCheckoutMaterialization: createScmWorkspaceIntegrationWorkspaceCheckoutMaterializationRequestFromRealization(
                workspaceCheckoutRealization,
            ),
        });

        return createScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult({
            kind: workspaceCheckoutRealization.kind,
            targetPath: materialized ? materialized.targetPath : input.targetPath,
            branchName: materialized ? materialized.branchName : workspaceCheckoutRealization.displayName,
            created: materialized ? materialized.created : true,
        });
    }

    if (!workspaceIntegration.createWorkspaceCheckout) {
        return null;
    }

    return await workspaceIntegration.createWorkspaceCheckout({
        context: input.context,
        workspaceCheckoutCreation: createScmWorkspaceIntegrationWorkspaceCheckoutCreationRequestFromRealization(
            workspaceCheckoutRealization,
        ),
    });
}

export async function realizeWorkspaceCheckoutWithScmWorkspace(input: Readonly<{
    sourcePath: string;
    targetPath?: string;
    checkoutCreation: Pick<
        ScmWorkspaceIntegrationWorkspaceCheckoutMaterializationInput['workspaceCheckoutMaterialization'],
        'kind' | 'displayName' | 'baseRef' | 'branchMode'
    >;
    registry?: ScmBackendRegistry;
}>): Promise<ScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult | null> {
    const resolved = await realizeWorkspaceCheckoutWithScmWorkspaceSource(input);
    return resolved?.realization ?? null;
}

/**
 * Retains the SCM-selected source root beside the checkout realization. This
 * remains daemon-internal evidence used to preserve a selected nested cwd;
 * callers do not need to rediscover or guess the repository root.
 */
export async function realizeWorkspaceCheckoutWithScmWorkspaceSource(input: Readonly<{
    sourcePath: string;
    targetPath?: string;
    checkoutCreation: Pick<
        ScmWorkspaceIntegrationWorkspaceCheckoutMaterializationInput['workspaceCheckoutMaterialization'],
        'kind' | 'displayName' | 'baseRef' | 'branchMode'
    >;
    registry?: ScmBackendRegistry;
}>): Promise<Readonly<{
    realization: ScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult;
    sourceRootPath: string;
}> | null> {
    return runWithScmBackendRegistryLease(input.registry, async (registry) => {
        const resolved = await resolveScmSelection({
            workingDirectory: input.sourcePath,
            cwd: input.sourcePath,
            registry,
        });
        if (!resolved) {
            return null;
        }

        const realization = await realizeWorkspaceCheckoutWithResolvedScmSelection({
            sourcePath: input.sourcePath,
            targetPath: input.targetPath,
            checkoutCreation: input.checkoutCreation,
            context: resolved.context,
            selection: resolved.selection,
        });
        return realization
            ? {
                realization,
                sourceRootPath: resolved.context.detection.rootPath ?? input.sourcePath,
            }
            : null;
    });
}
