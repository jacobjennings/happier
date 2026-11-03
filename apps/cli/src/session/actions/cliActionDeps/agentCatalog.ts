import type { CliActionDepsParams } from './types';
import type { AcpCatalogUnavailableError } from '@/agent/acp/catalog/configured/resolveBackend';
import type { ActionExecutorDeps } from '@happier-dev/protocol';
import { runWithServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import type { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { getActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAccountSettingsScopeKeyForToken } from '@/settings/accountSettings/accountSettingsScopeKey';
import type { createCliAcpCatalogStore } from '@/agent/acp/catalog/acpCatalogStore';
export function createCliAgentCatalogActionDeps(
  params: Pick<CliActionDepsParams, 'credentials' | 'savedSecretOperationContext'>,
  { todoHomeBaseUrl }: Readonly<{
    todoHomeBaseUrl: string;
  }>,
): Pick<ActionExecutorDeps, 'updateAccountAcpCatalogSettings'> {
  return {
    updateAccountAcpCatalogSettings: async ({ mutate, signal, expectedRevision, sourceSettingsVersion }) => {
      if (!params.credentials) return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      return await runWithServerHttpBaseUrl(params.savedSecretOperationContext?.serverHttpBaseUrl ?? todoHomeBaseUrl, async () => {
        try {
          if (!params.savedSecretOperationContext && getActiveAccountSettingsSnapshot()?.scopeKey
            !== resolveAccountSettingsScopeKeyForToken(params.credentials!.token)) {
            const { bootstrapAccountSettingsContext } = await import("@/settings/accountSettings/bootstrapAccountSettingsContext");
            await bootstrapAccountSettingsContext({ credentials: params.credentials!, mode: 'blocking' });
          }
          const { createCliAcpCatalogStore } = await import("@/agent/acp/catalog/acpCatalogStore");
          const result = await createCliAcpCatalogStore({ credentials: params.credentials!, signal,
            operationContext: params.savedSecretOperationContext }).updateCatalog(mutate, { expectedRevision, sourceSettingsVersion });
          // Publication may retire after acknowledgement; the durable row receipt still succeeds.
          if (result.status === 'updated') return { ok: true as const,
            revision: result.revision,
            ...('cleanup' in result ? { cleanup: result.cleanup } : {}),
          };
          if (result.status === 'unchanged') return { ok: false as const,
            errorCode: 'acp_catalog_unavailable', error: 'acp_catalog_unavailable',
          };
          const details = { ...('revision' in result ? { revision: result.revision } : {}), ...('reason' in result ? { reason: result.reason } : {}) };
          const errorCode = result.status === 'conflict' ? 'conflict' : `acp_catalog_${result.status}`;
          return { ok: false as const, errorCode, error: errorCode, ...(Object.keys(details).length > 0 ? { details } : {}) };
        } catch (error) {
          const { AcpCatalogUnavailableError } = await import("@/agent/acp/catalog/configured/resolveBackend");
          if (error instanceof AcpCatalogUnavailableError) {
            return { ok: false as const, errorCode: error.code, error: error.code, details: {
              reason: error.reason,
              ...(typeof error.revision === 'number' && Number.isSafeInteger(error.revision) && error.revision >= 0
                ? { revision: error.revision } : {}),
            } };
          }
          const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code
            : signal?.aborted ? 'cancelled' : 'acp_catalog_unavailable';
          return { ok: false as const, errorCode: code, error: code };
        }
      });
    },
  };
}
