import { normalizeId, readNullableString } from '../inputReading.js';
import { resolveServerIdForSession } from '../sessionScope.js';
import { completeActionResult } from '../resultProjection.js';
import { hasOwn } from '../../../inputs/inputRecords.js';
import type { CoreInvocation, DispatchFacts, PreparedCoreAdmission } from '../coreInvocation.js';
import type { ActionExecuteResult, ActionExecutorContext, ActionExecutorDeps } from '../types.js';

function readTranscriptDirection(raw: unknown): 'before' | 'after' | undefined {
  return raw === 'before' || raw === 'after' ? raw : undefined;
}

function readTranscriptScope(raw: unknown): 'main' | 'sidechain' | 'all' | undefined {
  return raw === 'main' || raw === 'sidechain' || raw === 'all' ? raw : undefined;
}

function readEventFormat(raw: unknown): 'compact' | 'raw' | undefined {
  return raw === 'compact' || raw === 'raw' ? raw : undefined;
}

export async function dispatchSessionTranscript(inv: Pick<CoreInvocation, 'actionId' | 'data' | 'deps' | 'ctx'>): Promise<ActionExecuteResult | null> {
  const { actionId, data, deps, ctx } = inv;

        if (actionId === 'session.vendor_plugin_catalog.list') {
          const sessionId = normalizeId(data.sessionId);
          if (!sessionId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          if (!deps.sessionVendorPluginCatalogList) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.vendor_plugin_catalog.list' };
          }
          const serverId = resolveServerIdForSession(deps, ctx, sessionId);
          const res = await deps.sessionVendorPluginCatalogList({
            sessionId,
            ...(typeof data.cwd === 'string' ? { cwd: data.cwd } : {}),
            ...(serverId ? { serverId } : {}),
          });
          return completeActionResult(res);
        }

        if (actionId === 'session.skill_catalog.list') {
          const sessionId = normalizeId(data.sessionId);
          if (!sessionId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          if (!deps.sessionSkillCatalogList) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.skill_catalog.list' };
          }
          const serverId = resolveServerIdForSession(deps, ctx, sessionId);
          const res = await deps.sessionSkillCatalogList({
            sessionId,
            ...(typeof data.cwd === 'string' ? { cwd: data.cwd } : {}),
            ...(serverId ? { serverId } : {}),
          });
          return completeActionResult(res);
        }

        if (actionId === 'session.history.get') {
          const sessionId = normalizeId(data.sessionId);
          if (!sessionId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          if (!deps.sessionEventsGet) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.events.get' };
          }
          const limit = typeof data.limit === 'number' ? data.limit : undefined;
          const format = data.format === 'raw' ? 'raw' : 'compact';
          const includeMeta = data.includeMeta === true;
          const includeStructuredPayload = data.includeStructuredPayload === true;
          const serverId = resolveServerIdForSession(deps, ctx, sessionId);
          const res = await deps.sessionEventsGet({
            sessionId,
            ...(typeof limit === 'number' ? { limit } : {}),
            format,
            includeMeta,
            includeStructuredPayload,
            ...(format === 'raw' ? { includeRaw: includeStructuredPayload } : {}),
            ...(serverId ? { serverId } : {}),
          }, { actionId, input: data, context: ctx });
          return completeActionResult(res);
        }

        if (actionId === 'session.input.result.get') {
          const sessionId = normalizeId(data.sessionId);
          const localId = typeof data.localId === 'string' ? data.localId : null;
          if (!sessionId || !localId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          if (!deps.sessionInputResultGet) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.input.result.get' };
          const serverId = resolveServerIdForSession(deps, ctx, sessionId);
          return completeActionResult(await deps.sessionInputResultGet({ context: ctx, sessionId, localId,
            ...(data.projection === 'reply' ? { projection: data.projection } : {}),
            ...(ctx.actionCaller?.kind === 'plugin' ? { callerPluginId: ctx.actionCaller.pluginId } : {}),
            ...(serverId ? { serverId } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) }));
        }

        if (actionId === 'session.transcript.get') {
          const sessionId = normalizeId(data.sessionId);
          if (!sessionId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          if (!deps.sessionTranscriptGet) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.transcript.get' };
          }
          const serverId = resolveServerIdForSession(deps, ctx, sessionId);
          const res = await deps.sessionTranscriptGet({
            context: ctx,
            sessionId,
            ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}),
            ...(data.projection === 'externalShareableV1' ? { projection: data.projection } : {}),
            ...(data.projection === 'externalShareableV1' && ctx.actionCaller?.kind === 'plugin'
              ? { callerPluginId: ctx.actionCaller.pluginId }
              : {}),
            ...(typeof data.limit === 'number' ? { limit: data.limit } : {}),
            ...(hasOwn(data, 'cursor') ? { cursor: readNullableString(data.cursor) } : {}),
            ...(readTranscriptDirection(data.direction) ? { direction: readTranscriptDirection(data.direction) } : {}),
            ...(readTranscriptScope(data.scope) ? { scope: readTranscriptScope(data.scope) } : {}),
            ...(hasOwn(data, 'sidechainId') ? { sidechainId: readNullableString(data.sidechainId) } : {}),
            ...(Array.isArray(data.roles) ? { roles: data.roles } : {}),
            ...(typeof data.includeTools === 'boolean' ? { includeTools: data.includeTools } : {}),
            ...(typeof data.includeReasoning === 'boolean' ? { includeReasoning: data.includeReasoning } : {}),
            ...(typeof data.includeEvents === 'boolean' ? { includeEvents: data.includeEvents } : {}),
            ...(typeof data.includeMeta === 'boolean' ? { includeMeta: data.includeMeta } : {}),
            ...(typeof data.includeStructuredPayload === 'boolean' ? { includeStructuredPayload: data.includeStructuredPayload } : {}),
            ...(typeof data.includeRaw === 'boolean' ? { includeRaw: data.includeRaw } : {}),
            ...(hasOwn(data, 'maxCharsPerMessage') ? { maxCharsPerMessage: typeof data.maxCharsPerMessage === 'number' ? data.maxCharsPerMessage : null } : {}),
            ...(hasOwn(data, 'maxRawPayloadChars') ? { maxRawPayloadChars: typeof data.maxRawPayloadChars === 'number' ? data.maxRawPayloadChars : null } : {}),
            ...(serverId ? { serverId } : {}),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          return completeActionResult(res);
        }

        if (actionId === 'session.events.get') {
          const sessionId = normalizeId(data.sessionId);
          if (!sessionId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          if (!deps.sessionEventsGet) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.events.get' };
          }
          const serverId = resolveServerIdForSession(deps, ctx, sessionId);
          const res = await deps.sessionEventsGet({
            sessionId,
            ...(typeof data.limit === 'number' ? { limit: data.limit } : {}),
            ...(hasOwn(data, 'cursor') ? { cursor: readNullableString(data.cursor) } : {}),
            ...(readTranscriptDirection(data.direction) ? { direction: readTranscriptDirection(data.direction) } : {}),
            ...(readTranscriptScope(data.scope) ? { scope: readTranscriptScope(data.scope) } : {}),
            ...(hasOwn(data, 'sidechainId') ? { sidechainId: readNullableString(data.sidechainId) } : {}),
            ...(Array.isArray(data.roles) ? { roles: data.roles } : {}),
            ...(Array.isArray(data.kinds) ? { kinds: data.kinds } : {}),
            ...(readEventFormat(data.format) ? { format: readEventFormat(data.format) } : {}),
            ...(typeof data.includeMeta === 'boolean' ? { includeMeta: data.includeMeta } : {}),
            ...(typeof data.includeStructuredPayload === 'boolean' ? { includeStructuredPayload: data.includeStructuredPayload } : {}),
            ...(typeof data.includeRaw === 'boolean' ? { includeRaw: data.includeRaw } : {}),
            ...(typeof data.maxTextChars === 'number' ? { maxTextChars: data.maxTextChars } : {}),
            ...(typeof data.maxPayloadChars === 'number' ? { maxPayloadChars: data.maxPayloadChars } : {}),
            ...(serverId ? { serverId } : {}),
          }, { actionId, input: data, context: ctx });
          return completeActionResult(res);
        }

        if (actionId === 'session.wait.idle') {
          const sessionId = normalizeId(data.sessionId);
          if (!sessionId) return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
          if (!deps.sessionWaitIdle) {
            return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:session.wait.idle' };
          }
          const timeoutSeconds = typeof data.timeoutSeconds === 'number' ? data.timeoutSeconds : 300;
          const serverId = resolveServerIdForSession(deps, ctx, sessionId);
          const res = await deps.sessionWaitIdle({ sessionId, timeoutSeconds, ...(serverId ? { serverId } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) });
          return completeActionResult(res);
        }
  return null;
}
