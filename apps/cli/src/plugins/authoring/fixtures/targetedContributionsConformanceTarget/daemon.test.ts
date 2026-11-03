import { describe, expect, it, vi } from 'vitest';

const targetPluginId = 'acme.targeted-contributions-conformance-target';
const contributorPluginId = 'acme.targeted-contributions-conformance-contributor';

type TargetAction = (input: unknown, context: unknown) => unknown | Promise<unknown>;

async function loadTargetAction(): Promise<TargetAction> {
  const fixture = await import(new URL('./daemon.mjs', import.meta.url).href);
  const activate = Reflect.get(fixture, 'activate');
  if (typeof activate !== 'function') throw new Error('Target fixture did not export activate');

  const actions = new Map<string, TargetAction>();
  await activate({
    actions: {
      register(actionId: string, handler: unknown) {
        if (typeof handler !== 'function') throw new Error(`Target fixture registered non-callable '${actionId}'`);
        actions.set(actionId, handler as TargetAction);
      },
    },
  });
  const action = actions.get('verify-targeted-admission');
  if (!action) throw new Error('Target fixture did not register its verification action');
  return action;
}

function contribution(handle: object, occurrenceId = 'contributor-occurrence-current') {
  return Object.freeze({
    contributor: Object.freeze({
      pluginId: contributorPluginId,
      contributionId: 'provider-a',
      occurrenceId,
    }),
    operations: Object.freeze({ verify: handle }),
  });
}

describe('targeted-contributions packed conformance target fixture', () => {
  it('executes the exact current opaque verify handle from the target-owned snapshot', async () => {
    const targetAction = await loadTargetAction();
    const signal = new AbortController().signal;
    const operation = Object.freeze({ opaque: 'current-operation' });
    const observation = {
      readCurrent: vi.fn(async () => Object.freeze({
        occurrenceId: 'target-occurrence-current',
        contributions: Object.freeze([contribution(operation)]),
      })),
      dispose: vi.fn(),
    };
    const observeForSelf = vi.fn(() => observation);
    const executeAdmittedTargetedOperation = vi.fn(async (
      actualOperation: object,
      input: unknown,
      options: unknown,
    ) => {
      expect(actualOperation).toBe(operation);
      expect(input).toEqual({});
      expect(options).toEqual({ signal });
      return Object.freeze({ verified: true });
    });

    await expect(targetAction({}, {
      signal,
      services: {
        targetedContributions: { observeForSelf },
        actions: { executeAdmittedTargetedOperation },
      },
    })).resolves.toEqual({
      targetOccurrenceId: 'target-occurrence-current',
      contributors: [{
        pluginId: contributorPluginId,
        contributionId: 'provider-a',
        occurrenceId: 'contributor-occurrence-current',
      }],
      verifications: [{
        contributor: {
          pluginId: contributorPluginId,
          contributionId: 'provider-a',
          occurrenceId: 'contributor-occurrence-current',
        },
        result: { verified: true },
      }],
    });
    expect(observeForSelf).toHaveBeenCalledWith({
      targetPluginId,
      id: 'providers',
      protocol: { id: 'packed-targeted-provider', version: 1 },
    }, { onInvalidated: expect.any(Function) });
    expect(observation.dispose).toHaveBeenCalledOnce();
    expect(executeAdmittedTargetedOperation).toHaveBeenCalledOnce();
  });
});
