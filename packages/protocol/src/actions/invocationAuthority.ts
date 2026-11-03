import { lazyZodSchema } from '../lazyZodSchema.js';
import { z } from 'zod/mini';
import type { ActionRequiredAuthority, ActionSurfaces } from './metadata.js';
import type { ActionId } from './actionIds.js';
import type { ActionExecutorContext } from './executor/types.js';

export const TerminalPresentUserPolicySchema = lazyZodSchema(() => z.enum(['allowed', 'disallowed']));
export type TerminalPresentUserPolicy = z.infer<typeof TerminalPresentUserPolicySchema>;
export const AUTHORITY_CEILING_HEADER_V1 = 'x-happier-authority-ceiling' as const;

/** A trusted present-person host invocation, never external or Session-supplied authority. */
export function isPresentUserHostInvocation(ctx: ActionExecutorContext): boolean {
  return (ctx.surface === 'ui' || ctx.surface === 'cli' || ctx.surface === 'voice')
    && (ctx.authority ?? 'account_automation') === 'present_user'
    && (!ctx.actionCaller || ctx.actionCaller.kind === 'host')
    && !ctx.externalActionCredential && !ctx.externalActionExecutionAuthorization
    && !ctx.rpcSessionAuthorization;
}

/** A machine can narrow the Account policy, never widen it. */
export function combineTerminalPresentUserPolicies(
  ...values: readonly (TerminalPresentUserPolicy | null | undefined)[]
): TerminalPresentUserPolicy {
  return values.includes('disallowed') ? 'disallowed' : 'allowed';
}

/** The sole producer of invocation authority from verified credential provenance. */
export function resolveInvocationAuthority(input: Readonly<{
  credential: 'account' | 'terminal' | 'api_token' | 'plugin' | 'agent' | 'none';
  surface: keyof ActionSurfaces;
  terminalPolicy?: TerminalPresentUserPolicy;
  /** Trusted host proof of a current built-in device-local UI mutation, never caller input. */
  localUiInteraction?: boolean;
  /** The Account host's current Voice preference, never Action input or a caller claim. */
  voiceCanApproveRequests?: boolean;
  actionId?: ActionId;
}>): ActionRequiredAuthority {
  if (input.credential === 'account' && (input.surface === 'ui' || input.surface === 'rpc')) return 'present_user';
  // Delegated Voice decisions use the existing person decision/replay authority.
  // Other Voice effects keep their normal automation policy and confirmation.
  if (input.credential === 'account' && input.surface === 'voice' && input.voiceCanApproveRequests === true
    && (input.actionId === 'approval.request.decide' || input.actionId === 'session.permission.respond'
      || input.actionId === 'session.user_action.answer')) return 'present_user';
  if (input.credential === 'none' && input.surface === 'ui' && input.localUiInteraction === true) return 'present_user';
  if (input.credential === 'terminal'
    && input.terminalPolicy === 'allowed'
    && (input.surface === 'cli' || input.surface === 'rpc')) return 'present_user';
  return 'account_automation';
}
