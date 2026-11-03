import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import type { ServerCredentialAccountScopeBinding, ServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useMachinePresetQuery } from './useMachinePresets';

afterEach(() => standardCleanup());

const bound = { kind: 'bound', scope: { serverId: 'srv', accountId: 'owner' } } as unknown as ServerCredentialAccountScopeResolution;
const resolving = { kind: 'resolving' } as unknown as ServerCredentialAccountScopeResolution;

describe('machine preset query scope', () => {
    it('settles quietly when the Account scope resolves on a page that reads no preset', async () => {
        const onAccessLost = vi.fn();
        const hook = await renderHook((props: { homeId: string | null; resolution: ServerCredentialAccountScopeResolution }) =>
            useMachinePresetQuery({ serverId: 'srv', homeId: props.homeId, binding: null, resolution: props.resolution, read: null, onAccessLost }),
            { initialProps: { homeId: null as string | null, resolution: resolving } });
        await hook.rerender({ homeId: 'home', resolution: bound });
        expect(hook.getCurrent().sameScope).toBe(true);
        expect(hook.getCurrent().state.error).toBeNull();
        expect(onAccessLost).not.toHaveBeenCalled();
    });

    it('withdraws a retained preset when its Account scope changes', async () => {
        const onAccessLost = vi.fn();
        const binding = { isCurrent: () => true, onRetire: () => ({ dispose: () => {} }) } as unknown as ServerCredentialAccountScopeBinding;
        const read = async () => ({ kind: 'succeeded' as const, value: { id: 'preset' } });
        const hook = await renderHook((props: { accountId: string }) => useMachinePresetQuery({ serverId: 'srv', homeId: 'home', presetId: 'preset', binding,
            resolution: { kind: 'bound', scope: { serverId: 'srv', accountId: props.accountId } } as unknown as ServerCredentialAccountScopeResolution,
            read, onAccessLost }), { initialProps: { accountId: 'owner' } });
        await vi.waitFor(() => expect(hook.getCurrent().state.value).toEqual({ id: 'preset' }));
        await hook.rerender({ accountId: 'other' });
        expect(onAccessLost).toHaveBeenCalledWith('action_account_scope_changed');
    });
});
