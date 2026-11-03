import { ApprovalRequestConflict } from '../../approvals/creation.js';
import type { ActionExecuteFailure } from './types.js';

/** Keep subject-admission refusals distinct from unavailable approval storage. */
export function approvalReadFailure(error?: unknown): ActionExecuteFailure {
  const errorCode = error instanceof ApprovalRequestConflict
    ? 'approval_request_conflict'
    : 'approval_context_unavailable';
  return { ok: false, errorCode, error: errorCode };
}
