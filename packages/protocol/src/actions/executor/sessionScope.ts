import type { ActionExecuteResult, ActionExecutorContext, ActionExecutorDeps, ActionSessionAddress, ActionSessionReferenceResolution } from './types.js';
import { normalizeId } from './inputReading.js';
import { readRecord, hasOwn } from '../../inputs/inputRecords.js';
import { readWidgetDefinitionActionSessionV1 } from '../../widgets/definitionActionsV1.js';
import { readWidgetActionSurfaceV1, readWidgetActionDestinationV1 } from '../../widgets/actionsV1.js';

export function resolveSessionIdFromInput(input: unknown, ctx: ActionExecutorContext): string | null {
  const sessionId = normalizeId(readRecord(input).sessionId);
  if (sessionId) return sessionId;
  const definitionSession = readWidgetDefinitionActionSessionV1(input);
  if (definitionSession) return definitionSession.sessionId;
  const widgetSurface = readWidgetActionSurfaceV1(input);
  if (widgetSurface?.owner.kind === 'sessionBoard' || widgetSurface?.owner.kind === 'companion') return widgetSurface.owner.sessionId;
  const widgetDestination = readWidgetActionDestinationV1(input);
  if (widgetDestination?.owner.kind === 'sessionBoard' || widgetDestination?.owner.kind === 'companion') return widgetDestination.owner.sessionId;
  const fallback = normalizeId(ctx.defaultSessionId);
  return fallback || null;
}

/**
 * The execution-run scope is deliberately not the general Session defaulting
 * rule: presence of `sessionId: null` is an explicit detached request, while
 * an omitted property may inherit the contextual Session. Do not collapse this
 * with `??` or truthiness; those would make explicit detached starts attach to
 * the current Session.
 */
export function resolveExecutionRunScope(input: unknown, ctx: ActionExecutorContext): string | null {
  const record = readRecord(input);
  if (hasOwn(record, 'sessionId') && record.sessionId !== undefined) {
    return record.sessionId === null ? null : normalizeId(record.sessionId) || null;
  }
  const fallback = normalizeId(ctx.defaultSessionId);
  return fallback || null;
}

export function withoutExecutionRunScope(input: unknown): Record<string, unknown> {
  const request = { ...readRecord(input) };
  delete request.sessionId;
  return request;
}

export function projectSessionReferenceFailure(
  resolution: Exclude<ActionSessionReferenceResolution, Readonly<{ kind: 'unique'; address: ActionSessionAddress }>>,
): ActionExecuteResult {
  if (resolution.kind === 'ambiguous') {
    return { ok: false, errorCode: 'session_id_ambiguous', error: 'session_id_ambiguous' };
  }
  if (resolution.kind === 'incomplete') {
    return { ok: false, errorCode: 'session_lookup_incomplete', error: 'session_lookup_incomplete' };
  }
  return { ok: false, errorCode: 'session_not_found', error: 'session_not_found' };
}

export function resolveServerIdForSession(deps: ActionExecutorDeps, ctx: ActionExecutorContext, sessionId: string): string | null {
  const explicit = normalizeId(ctx.serverId);
  if (explicit) return explicit;
  return deps.resolveServerIdForSessionId ? deps.resolveServerIdForSessionId(sessionId) : null;
}

export function resolveServerIdForExecutionRunScope(
  deps: ActionExecutorDeps,
  ctx: ActionExecutorContext,
  sessionId: string | null,
): string | null {
  if (sessionId) return resolveServerIdForSession(deps, ctx, sessionId);
  return normalizeId(ctx.serverId) || null;
}
