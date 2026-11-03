import type { ApprovalRequest } from '../../approvals/approvalRequestV1.js';
import { isBlockingApprovalRequest } from './approvalOrigins.js';
import type { ActionRequiredAuthority } from '../metadata.js';
import type { ActionExecutorContext, ActionExecutorDeps } from './types.js';

type BlockingDecisionArgs = Readonly<{
  artifactId: string;
  decision: 'approve' | 'reject';
  decisionAuthority: ActionRequiredAuthority;
  requesterApprovalDecision?: ActionExecutorContext['requesterApprovalDecision'];
  request: ApprovalRequest;
  serverId: string | null;
}>;

/** Bind live decision delivery and show-once result custody to the existing waiter. */
export function createBlockingApprovalDecisionResolver(deps: Pick<ActionExecutorDeps,
  'approvalsResolveBlockingDecision' | 'prepareApprovedApiTokenExecution'>): (args: BlockingDecisionArgs) => Promise<boolean> {
  return async args => {
    const tokenExecution = args.decision === 'approve' && args.decisionAuthority === 'present_user'
      && args.request.actionId === 'account.apiTokens.create' && isBlockingApprovalRequest(args.request)
      ? await deps.prepareApprovedApiTokenExecution?.({ artifactId: args.artifactId, request: args.request }) ?? undefined
      : undefined;
    let claimed = false;
    try {
      const resolved = await deps.approvalsResolveBlockingDecision?.({
        artifactId: args.artifactId,
        decision: args.decision,
        decisionAuthority: args.decisionAuthority,
        ...(args.requesterApprovalDecision ? { requesterApprovalDecision: args.requesterApprovalDecision } : {}),
        request: args.request,
        serverId: args.serverId,
        ...(tokenExecution ? { tokenExecution } : {}),
      });
      claimed = resolved?.resolved === true;
      if (claimed) await tokenExecution?.settled;
      return claimed;
    } finally { if (!claimed) await tokenExecution?.dispose(); }
  };
}
