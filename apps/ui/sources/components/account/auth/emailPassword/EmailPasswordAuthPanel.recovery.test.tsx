import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { EmailPasswordAuthPanel } from './EmailPasswordAuthPanel';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const passwordLogin = vi.hoisted(() => ({ login: vi.fn() }));
const nativeEmail = vi.hoisted(() => ({
    requestVerification: vi.fn(),
    rememberInvitation: vi.fn(),
}));
const provision = vi.hoisted(() => ({ account: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('@/auth/password/loginEmailPassword', () => ({ loginEmailPassword: passwordLogin.login }));
vi.mock('@/auth/password/provisionEmailPasswordAccount', () => ({ provisionEmailPasswordAccount: provision.account }));
vi.mock('@/sync/api/auth/nativeAuthEmail', () => ({
    requestNativeEmailVerification: nativeEmail.requestVerification,
    rememberNativeEmailVerificationContinuation: nativeEmail.rememberInvitation,
    requestNativePasswordReset: vi.fn(),
}));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

let screen: Awaited<ReturnType<typeof renderScreen>> | null = null;

afterEach(async () => {
    await screen?.unmount();
    screen = null;
    router.push.mockReset();
    passwordLogin.login.mockReset();
    nativeEmail.requestVerification.mockReset();
    nativeEmail.rememberInvitation.mockReset();
    provision.account.mockReset();
});

/**
 * Fills whatever this creation step actually asks for. A Home that proves the
 * mailbox first renders no password fields, because the Account is created on
 * the verification landing rather than here.
 */
async function fillProvisionForm(rendered: NonNullable<typeof screen>) {
    await act(async () => {
        rendered.findByTestId('email-password-email')!.props.onChangeText(' Person@Example.test ');
        rendered.findByTestId('email-password-password')?.props.onChangeText('a sufficiently long password');
        rendered.findByTestId('email-password-confirm')?.props.onChangeText('a sufficiently long password');
    });
}

it('binds a transferable invitation to the verification request and retains its exact continuation', async () => {
    const admission = { kind: 'team_invitation' as const, token: 'A'.repeat(43) };
    nativeEmail.requestVerification.mockResolvedValue(undefined);
    screen = await renderScreen(
        <EmailPasswordAuthPanel
            target={{
                endpointUrl: 'https://home-a.example.test',
                canonicalServerUrl: 'https://home-a.example.test',
                addressAnchorUrl: 'https://home-a.example.test',
                serverId: 'home-a',
                serverIdentityId: 'srv_home_a',
            }}
            recoveryTarget="srv_home_a"
            action="provision"
            mode="keyless"
            admission={admission}
            invitationEmailVerificationRequired
            onAuthenticated={vi.fn()}
        />,
    );
    await fillProvisionForm(screen);

    await screen.pressByTestIdAsync('email-password-create');

    expect(nativeEmail.requestVerification).toHaveBeenCalledWith(expect.any(Function), {
        email: 'person@example.test',
        admission,
    });
    expect(nativeEmail.rememberInvitation).toHaveBeenCalledWith({
        homeServerIdentityId: 'srv_home_a',
        normalizedEmail: 'person@example.test',
        admission,
    });
    expect(provision.account).not.toHaveBeenCalled();
});

it('provisions an addressed invitation directly without redundant mailbox verification', async () => {
    const admission = { kind: 'team_invitation' as const, token: 'B'.repeat(43) };
    provision.account.mockResolvedValue({ credentials: { token: 'created' }, accountId: 'account-a', teamId: 'team-a' });
    screen = await renderScreen(
        <EmailPasswordAuthPanel
            target={{
                endpointUrl: 'https://home-a.example.test',
                canonicalServerUrl: 'https://home-a.example.test',
                addressAnchorUrl: 'https://home-a.example.test',
                serverId: 'home-a',
                serverIdentityId: 'srv_home_a',
            }}
            recoveryTarget="srv_home_a"
            action="provision"
            mode="keyless"
            admission={admission}
            invitationEmailVerificationRequired={false}
            onAuthenticated={vi.fn()}
        />,
    );
    await fillProvisionForm(screen);

    await screen.pressByTestIdAsync('email-password-create');

    expect(provision.account).toHaveBeenCalledWith(expect.objectContaining({ admission }));
    expect(nativeEmail.requestVerification).not.toHaveBeenCalled();
    expect(nativeEmail.rememberInvitation).not.toHaveBeenCalled();
});

it('does not retain a transferable invitation after its verification request loses navigation custody', async () => {
    let finishRequest!: () => void;
    nativeEmail.requestVerification.mockImplementation(async () => await new Promise<void>((resolve) => {
        finishRequest = resolve;
    }));
    const admission = { kind: 'team_invitation' as const, token: 'C'.repeat(43) };
    const renderPanel = (suffix: 'a' | 'b') => (
        <EmailPasswordAuthPanel
            target={{
                endpointUrl: `https://home-${suffix}.example.test`,
                canonicalServerUrl: `https://home-${suffix}.example.test`,
                addressAnchorUrl: `https://home-${suffix}.example.test`,
                serverId: `home-${suffix}`,
                serverIdentityId: `srv_home_${suffix}`,
            }}
            recoveryTarget={`srv_home_${suffix}`}
            action="provision"
            mode="keyless"
            admission={admission}
            invitationEmailVerificationRequired
            onAuthenticated={vi.fn()}
        />
    );
    screen = await renderScreen(renderPanel('a'));
    await fillProvisionForm(screen);
    await act(async () => {
        screen!.pressByTestId('email-password-create');
        await Promise.resolve();
    });

    await screen.update(renderPanel('b'));
    await act(async () => finishRequest());

    expect(nativeEmail.rememberInvitation).not.toHaveBeenCalled();
    expect(screen.findByTestId('email-password-sent-detail')).toBeNull();
});

it('retires a pending login when the exact Home target changes', async () => {
    let resolveLogin!: (credentials: { token: string }) => void;
    passwordLogin.login.mockImplementation(async () => await new Promise((resolve) => { resolveLogin = resolve; }));
    const onAuthenticated = vi.fn();
    const recoveryTarget = 'srv_home_a';
    const renderPanel = (suffix: 'a' | 'b') => <EmailPasswordAuthPanel
        target={{
            endpointUrl: `https://home-${suffix}.example.test`,
            canonicalServerUrl: `https://home-${suffix}.example.test`,
            addressAnchorUrl: `https://home-${suffix}.example.test`,
            serverId: `home-${suffix}`,
            serverIdentityId: `srv_home_${suffix}`,
        }}
        recoveryTarget={recoveryTarget}
        action="login"
        mode="either"
        onAuthenticated={onAuthenticated}
    />;
    screen = await renderScreen(renderPanel('a'));
    await act(async () => {
        screen!.findByTestId('email-password-email')!.props.onChangeText('person@example.test');
        screen!.findByTestId('email-password-password')!.props.onChangeText('a sufficiently long password');
    });
    await act(async () => {
        screen!.pressByTestId('email-password-submit');
        await Promise.resolve();
    });

    await act(async () => { screen!.tree.update(renderPanel('b')); });
    await act(async () => { resolveLogin({ token: 'late-token' }); });

    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(screen.findByTestId('email-password-email')!.props.value).toBe('');
});

it('erases a retired provision result recovery key instead of leaving it in memory', async () => {
    let resolveProvision!: (result: unknown) => void;
    provision.account.mockImplementation(async () => await new Promise((resolve) => { resolveProvision = resolve; }));
    const onAuthenticated = vi.fn();
    const admission = { kind: 'team_invitation' as const, token: 'D'.repeat(43) };
    const renderPanel = (suffix: 'a' | 'b') => (
        <EmailPasswordAuthPanel
            target={{
                endpointUrl: `https://home-${suffix}.example.test`,
                canonicalServerUrl: `https://home-${suffix}.example.test`,
                addressAnchorUrl: `https://home-${suffix}.example.test`,
                serverId: `home-${suffix}`,
                serverIdentityId: `srv_home_${suffix}`,
            }}
            recoveryTarget={`srv_home_${suffix}`}
            action="provision"
            mode="either"
            admission={admission}
            invitationEmailVerificationRequired={false}
            onAuthenticated={onAuthenticated}
        />
    );
    screen = await renderScreen(renderPanel('a'));
    await fillProvisionForm(screen);
    await act(async () => {
        screen!.pressByTestId('email-password-create');
        await Promise.resolve();
    });

    const recoverySecret = new Uint8Array(32).fill(7);
    const fill = vi.spyOn(recoverySecret, 'fill');
    await act(async () => { screen!.tree.update(renderPanel('b')); });
    await act(async () => resolveProvision({
        credentials: { token: 'late-token', secret: 'late-secret' },
        accountId: 'account-a',
        teamId: null,
        recoverySecret,
    }));

    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(fill).toHaveBeenCalledTimes(1);
    expect(fill).toHaveBeenCalledWith(0);
    expect(Array.from(recoverySecret).every((byte) => byte === 0)).toBe(true);
});
