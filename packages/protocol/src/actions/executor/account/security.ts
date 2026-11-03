import { PluginAccountDataEraseActionInputV1Schema } from '../../../plugins/data/accountEraseV1.js';
import { completeActionResult } from '../resultProjection.js';
import { AccountSessionsSignOutEverywhereActionInputV1Schema } from '../../../auth/accountSessions.js';
import { AccountApiTokensCreateActionInputV1Schema, AccountApiTokensListActionInputV1Schema, AccountApiTokensRevokeActionInputV1Schema, AccountApiTokensUpdateActionInputV1Schema, AccountApiTokensRevokeAllActionInputV1Schema } from '../../../auth/accountApiTokens.js';
import { AccountEmailChangeRequestV1Schema, AccountPasswordChangeRequestV1Schema, AccountPasswordEnrollRequestV1Schema, AccountPasswordRemoveRequestV1Schema, AccountSecurityGetRequestV1Schema, AccountTerminalPresentUserPolicySetRequestV1Schema } from '../../../auth/accountSecurity.js';
import type { CoreInvocation, DispatchFacts, PreparedCoreAdmission } from '../coreInvocation.js';
import type { ActionExecuteResult, ActionExecutorContext, ActionExecutorDeps } from '../types.js';



export async function dispatchAccountSecurity(inv: Pick<CoreInvocation, 'actionId' | 'deps' | 'parsed' | 'ctx' | 'options'>): Promise<ActionExecuteResult | null> {
  const { actionId, deps, parsed, ctx, options } = inv;

      if (actionId === 'account.plugins.data.erase') {
        if (!deps.accountPluginDataEraseAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountPluginDataEraseAction({
          input: PluginAccountDataEraseActionInputV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.sessions.signOutEverywhere') {
        if (!deps.accountSessionsSignOutEverywhereAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountSessionsSignOutEverywhereAction({
          input: AccountSessionsSignOutEverywhereActionInputV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.apiTokens.create') {
        if (options?.approvedApiTokenExecution) {
          return await options.approvedApiTokenExecution.execute(parsed.data, ctx.signal);
        }
        if (!deps.accountApiTokensCreateAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountApiTokensCreateAction({
          input: AccountApiTokensCreateActionInputV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.apiTokens.list') {
        if (!deps.accountApiTokensListAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountApiTokensListAction({
          input: AccountApiTokensListActionInputV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.encryption.automationTemplates.recover') {
        if (!deps.accountEncryptionAutomationTemplatesRecoverAction) {
          return { ok: false, errorCode: 'target_unavailable', error: 'Historical template recovery belongs to the invoking client; no client key custodian is available.' };
        }
        return completeActionResult(await deps.accountEncryptionAutomationTemplatesRecoverAction({
          input: {}, context: ctx, ...(ctx.signal ? { signal: ctx.signal } : {}),
        }));
      }

      if (actionId === 'account.encryption.historicalKey.forget') {
        if (!deps.accountHistoricalEncryptionKeyForgetAction) {
          return { ok: false, errorCode: 'target_unavailable', error: 'Historical credentials belong to the invoking client; no client credential custodian is available.' };
        }
        return completeActionResult(await deps.accountHistoricalEncryptionKeyForgetAction({
          input: {}, context: ctx, ...(ctx.signal ? { signal: ctx.signal } : {}),
        }));
      }

      if (actionId === 'account.apiTokens.update') {
        if (!deps.accountApiTokensUpdateAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        return completeActionResult(await deps.accountApiTokensUpdateAction({
          input: AccountApiTokensUpdateActionInputV1Schema.parse(parsed.data), context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        }));
      }

      if (actionId === 'account.apiTokens.revoke') {
        if (!deps.accountApiTokensRevokeAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountApiTokensRevokeAction({
          input: AccountApiTokensRevokeActionInputV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.apiTokens.revokeAll') {
        if (!deps.accountApiTokensRevokeAllAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountApiTokensRevokeAllAction({
          input: AccountApiTokensRevokeAllActionInputV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      // Lane 02 Account Security family. Each row declares its explicit domain
      // transport; the host below owns reachability to one exact Home/Account
      // while the Home transaction retains authentication, authorization,
      // validation, rate limits, encryption, and transaction ownership.
      if (actionId === 'account.security.get') {
        if (!deps.accountSecurityGetAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountSecurityGetAction({
          input: AccountSecurityGetRequestV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.security.terminalPresentUser.set') {
        if (!deps.accountSecurityTerminalPresentUserSetAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        return completeActionResult(await deps.accountSecurityTerminalPresentUserSetAction({
          input: AccountTerminalPresentUserPolicySetRequestV1Schema.parse(parsed.data), context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        }));
      }

      if (actionId === 'account.password.enroll') {
        if (!deps.accountPasswordEnrollAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountPasswordEnrollAction({
          input: AccountPasswordEnrollRequestV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.password.change') {
        if (!deps.accountPasswordChangeAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountPasswordChangeAction({
          input: AccountPasswordChangeRequestV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.password.remove') {
        if (!deps.accountPasswordRemoveAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountPasswordRemoveAction({
          input: AccountPasswordRemoveRequestV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }

      if (actionId === 'account.email.change.request') {
        if (!deps.accountEmailChangeRequestAction) {
          return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
        }
        const result = await deps.accountEmailChangeRequestAction({
          input: AccountEmailChangeRequestV1Schema.parse(parsed.data),
          context: ctx,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        return completeActionResult(result);
      }
  return null;
}
