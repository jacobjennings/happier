import type { CliActionDepsParams } from './types';
import { applyTodoSessionLinkV1, TodoSessionLinkErrorV1, TodoSessionLinkInputV1Schema, projectTodoSessionLinkFailureV1 } from '@happier-dev/protocol/todos/todoSessionLinkV1';
import type { createCliAccountKvJsonTransport, createCliAccountKvJsonCollectionTransport } from '@/api/client/accountKvJsonTransport';
import { executeInternalTaskAction, executeInternalTaskReorder } from '@happier-dev/protocol/todos/todoActionOperationsV1';
import { randomUUID } from 'node:crypto';
import type { ActionExecutorDeps, ActionExecutorContext } from '@happier-dev/protocol';
import { configuration } from '@/configuration';
export function createCliTasksActionDeps(
  params: Pick<CliActionDepsParams, 'credentials' | 'serverId'>,
  { homeAccountId, resolveServerRequestHeaders, todoHomeBaseUrl, todoHomeServerId }: Readonly<{
    homeAccountId: string | null;
    resolveServerRequestHeaders: (context: ActionExecutorContext | undefined, effectActionId: string, request: Readonly<{ method: string; path: string; body?: unknown }>) => Readonly<Record<string, string>> | null;
    todoHomeBaseUrl: string;
    todoHomeServerId: string;
  }>,
): Pick<ActionExecutorDeps, 'internalTaskAction' | 'listReorder' | 'todoSessionLink'> {
  return {
    internalTaskAction: async ({ actionId, input, context, signal }) => {
      if (!params.credentials || !homeAccountId) return { status: 'unavailable' };
      const requireCurrent = () => {
        if (signal?.aborted || (params.serverId === undefined && configuration.activeServerId !== todoHomeServerId)) {
          throw Object.assign(new Error('task_scope_mismatch'), { code: 'task_scope_mismatch' });
        }
      };
      const { createCliAccountKvJsonCollectionTransport } = await import("@/api/client/accountKvJsonTransport");
      return executeInternalTaskAction({ actionId, input, scope: { serverId: todoHomeServerId, accountId: homeAccountId }, requireCurrent, createId: randomUUID,
        port: createCliAccountKvJsonCollectionTransport({ credentials: params.credentials, serverBaseUrl: todoHomeBaseUrl, signal,
          shouldContinue: () => !signal?.aborted && (params.serverId !== undefined || configuration.activeServerId === todoHomeServerId),
          resolveAuthorizationHeaders: request => { requireCurrent(); return resolveServerRequestHeaders(context, actionId, request); },
        }),
      });
    },
    listReorder: async ({ actionId, input, context, signal }) => {
      if (actionId !== 'tasks.internal.reorder' || !params.credentials || !homeAccountId) return { status: 'unavailable' };
      const requireCurrent = () => {
        if (signal?.aborted || (params.serverId === undefined && configuration.activeServerId !== todoHomeServerId)) {
          throw Object.assign(new Error('task_scope_mismatch'), { code: 'task_scope_mismatch' });
        }
      };
      const { createCliAccountKvJsonCollectionTransport } = await import("@/api/client/accountKvJsonTransport");
      return executeInternalTaskReorder({ input, scope: { serverId: todoHomeServerId, accountId: homeAccountId }, requireCurrent,
        port: createCliAccountKvJsonCollectionTransport({ credentials: params.credentials, serverBaseUrl: todoHomeBaseUrl, signal,
          shouldContinue: () => !signal?.aborted && (params.serverId !== undefined || configuration.activeServerId === todoHomeServerId),
          resolveAuthorizationHeaders: request => { requireCurrent(); return resolveServerRequestHeaders(context, actionId, request); },
        }),
      });
    },
    todoSessionLink: async ({ input, context, signal }) => {
      const parsed = TodoSessionLinkInputV1Schema.safeParse(input);
      if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
      if (!params.credentials || !homeAccountId) return { status: 'unavailable' };
      // The executor's captured Home/credentials are the Account authority, not a caller-supplied URL.
      const requireCurrent = () => {
        if (signal?.aborted || parsed.data.scope.serverId !== todoHomeServerId || parsed.data.scope.accountId !== homeAccountId
          || (params.serverId === undefined && configuration.activeServerId !== todoHomeServerId)) {
          throw new TodoSessionLinkErrorV1('task_scope_mismatch');
        }
      };
      try {
        requireCurrent();
        const { createCliAccountKvJsonTransport } = await import("@/api/client/accountKvJsonTransport");
        await applyTodoSessionLinkV1(parsed.data, createCliAccountKvJsonTransport({
          credentials: params.credentials, key: `todo.${parsed.data.taskId}`,
          serverBaseUrl: todoHomeBaseUrl,
          ...(signal ? { signal } : {}),
          resolveAuthorizationHeaders: request => {
            requireCurrent();
            return resolveServerRequestHeaders(context, 'tasks.internal.session.link', request);
          },
        }), { requireCurrent });
        return { status: parsed.data.linked === false ? 'unlinked' : 'linked' };
      } catch (error) { return projectTodoSessionLinkFailureV1(error); }
    },
  };
}
