import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installAccountCommonModuleMocks } from './accountTestHelpers';

const runtime = vi.hoisted(() => ({
    focused: [] as string[],
    recover: vi.fn(),
}));

// The host TextInput is the platform boundary that receives focus; PasswordField and its ref
// forwarding stay real above it.
installAccountCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock, createFocusableTextInputMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            TextInput: createFocusableTextInputMock(() => {}, (props) => { runtime.focused.push(String(props.testID)); }),
        });
    },
});

vi.mock('@/auth/password/recoverPasswordEnvelopeSecret', () => ({
    recoverPasswordEnvelopeSecret: (...args: unknown[]) => runtime.recover(...args),
}));

// installAccountCommonModuleMocks registers its mocks when it runs, so the owner graph loads after it.
const { RecoveryKeyUnlockModal } = await import('./RecoveryKeyUnlockModal');

afterEach(() => {
    standardCleanup();
    runtime.focused.length = 0;
    runtime.recover.mockReset();
});

describe('RecoveryKeyUnlockModal', () => {
    it('focuses the password field after a failed local unlock', async () => {
        runtime.recover.mockRejectedValueOnce(new Error('password_authentication_failed'));
        const screen = await renderScreen(<RecoveryKeyUnlockModal
            email="person@example.test"
            request={vi.fn()}
            onUnlocked={vi.fn()}
            onClose={vi.fn()}
        />);

        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('wrong password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');

        expect(runtime.focused).toEqual(['recovery-key-unlock-password']);
        expect(screen.findHostByTestId('recovery-key-unlock-password-error')).not.toBeNull();
    });

    it('clears the recovered bytes after handing a usable view to the disclosure owner', async () => {
        const recovered = new Uint8Array(32).fill(29);
        runtime.recover.mockResolvedValueOnce(recovered);
        const observed: number[][] = [];
        const screen = await renderScreen(<RecoveryKeyUnlockModal
            email="person@example.test"
            request={vi.fn()}
            onUnlocked={(value) => { observed.push(Array.from(value)); }}
            onClose={vi.fn()}
        />);

        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('right password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');

        expect(observed[0]).toEqual(new Array(32).fill(29));
        expect(recovered).toEqual(new Uint8Array(32));
        expect(screen.findByTestId('recovery-key-unlock-password')?.props.value).toBe('');
    });

    it('asks for the sign-in email too when the caller does not know it, and unlocks with what was typed', async () => {
        runtime.recover.mockRejectedValueOnce(new Error('password_authentication_failed'));
        runtime.recover.mockResolvedValueOnce(new Uint8Array(32).fill(5));
        const onUnlocked = vi.fn();
        const screen = await renderScreen(<RecoveryKeyUnlockModal
            email={null}
            request={vi.fn()}
            onUnlocked={onUnlocked}
            onClose={vi.fn()}
        />);

        await act(async () => screen.findByTestId('recovery-key-unlock-email')?.props.onChangeText('person@example.test'));
        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('wrong password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');
        // A wrong pair is a typed error under the field; the key is not disclosed.
        expect(screen.findHostByTestId('recovery-key-unlock-password-error')).not.toBeNull();
        expect(onUnlocked).not.toHaveBeenCalled();
        expect(runtime.recover).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'person@example.test' }));

        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('right password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');
        expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
});
