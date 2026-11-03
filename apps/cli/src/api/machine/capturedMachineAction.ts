import { getActionSpec } from '@happier-dev/protocol/actions/actionSpecs';
import type { ActionId } from '@happier-dev/protocol/actions';

/** Admission belongs to the captured invoker; an acknowledged effect outlives its cancellation or retirement. */
export async function executeCapturedMachineAction<Result>(input: Readonly<{
  actionId: ActionId;
  assertCurrent: () => Promise<void>;
  invoke: (options: Readonly<{ timeoutMs?: null }>) => Promise<Result>;
}>): Promise<Result> {
  const spec = getActionSpec(input.actionId);
  await input.assertCurrent();
  try {
    return await input.invoke(spec.sideEffectClass === 'read' ? {} : { timeoutMs: null });
  } finally {
    // A refusal can contain Account facts too. Reads revalidate both response
    // and exception paths; acknowledged effects retain their settled result.
    if (spec.sideEffectClass === 'read') await input.assertCurrent();
  }
}
