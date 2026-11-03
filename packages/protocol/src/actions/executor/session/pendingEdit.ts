import { SessionPendingEditInputV1Schema } from '../../specs/session/pendingEdit.js';
import { withoutClientActionInput } from '../../clientActionInput.js';
import { completeActionResult } from '../resultProjection.js';
import type { CoreInvocation } from '../coreInvocation.js';

export async function dispatchSessionPendingEdit(inv: Pick<CoreInvocation, 'actionId' | 'parsed' | 'ctx' | 'deps'>) {
  if (inv.actionId !== 'session.pending.edit') return null;
  if (!inv.deps.sessionPendingEdit) return { ok: false as const, errorCode: 'unsupported_action', error: 'unsupported_action' };
  return completeActionResult(await inv.deps.sessionPendingEdit({
    input: SessionPendingEditInputV1Schema.parse(withoutClientActionInput(inv.parsed.data)), context: inv.ctx,
  }));
}
