import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';

// Navigation is an external platform boundary; this task family never navigates.
vi.mock('expo-router/build/link/href', () => ({ resolveHref: vi.fn() }));

const approvalMocks = vi.hoisted(() => ({
    readCredentials: vi.fn(),
    serverFetch: vi.fn(),
    createServerFetchAtEndpoint: vi.fn(),
    endpointFetch: vi.fn(),
}));

const modalSpies = vi.hoisted(() => ({
    // Typed like `Modal.confirm` so the assertions below can read the body argument the
    // consent presenter builds.
    confirm: vi.fn(async (_title: string, _body?: string, _options?: unknown) => false),
}));

// Mock factories import the leaf testkit mock modules, never the full `@/dev/testkit` barrel:
// awaiting the barrel inside a factory can deadlock module evaluation.
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { confirm: modalSpies.confirm } }).module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    // Interpolate the consent copy's one parameter so the assertions below can prove the resolved
    // command actually reaches the question the person is shown, not just that a key was rendered.
    return createTextModuleMock({
        translate: (key: string, params?: Record<string, unknown>) => (
            key === 'machine.cliTrust.body' ? `${key}:${String(params?.command)}` : key
        ),
    });
});

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    TokenStorage: {
        getCredentialsForServerUrl: (...args: unknown[]) => approvalMocks.readCredentials(...args),
    },
}));

vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    serverFetch: (...args: unknown[]) => approvalMocks.serverFetch(...args),
    createServerFetchAtEndpoint: (...args: unknown[]) => approvalMocks.createServerFetchAtEndpoint(...args),
}));

import { buildLocalMachineSetupSystemTaskSpec } from './buildLocalMachineSetupSystemTaskSpec';
import { createManualSystemTaskRunner as createManualRunner } from '@/dev/testkit/harness/manualSystemTaskRunner';
import { useThisComputerSetupTask } from './useThisComputerSetupTask';

describe('useThisComputerSetupTask Personal Home composition', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('resumes the same running setup after its presenter remounts', async () => {
        const manual = createManualRunner();
        const first = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner }));
        let taskId = '';
        await act(async () => {
            taskId = await first.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                activeRelayUrl: 'https://home.example.test', activeWebappUrl: 'https://home.example.test',
            }));
        });
        await first.unmount();
        const resumed = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner, taskId }));
        await act(async () => manual.emitResult(taskId, {
            protocolVersion: 1, taskId, ok: true, data: { machineId: 'joined-machine' },
        }));
        expect(resumed.getCurrent().completedMachineId).toBe('joined-machine');
        expect(resumed.getCurrent().activeTaskId).toBe(taskId);
        await resumed.unmount();
    });

    it('starts the existing local-machine recipe from the supplied Home descriptor without changing it', async () => {
        const manual = createManualRunner();
        const spec = buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: 'http://127.0.0.1:43123',
            activeWebappUrl: 'http://127.0.0.1:43123',
            activeLocalRelayUrl: 'http://127.0.0.1:43123',
            installService: true,
            startService: true,
            verifyService: true,
        });
        const hook = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner }));

        let taskId: string | undefined;
        await act(async () => {
            taskId = await hook.getCurrent().start(spec);
        });

        expect(taskId).toBe('personal-home-task-1');
        expect(manual.bridge.start).toHaveBeenCalledWith(spec);
        expect(manual.bridge.start).toHaveBeenCalledTimes(1);
    });

    // The setup kind raises its service-consent prompts before it mutates anything, and
    // `ctx.prompt` is an unbounded promise: a starter with no responder leaves the run waiting
    // forever with nothing to cancel. The responder therefore belongs to this one owner, so the
    // Personal Home first-run path answers them without mounting anything of its own.
    it.each([
        ['releaseChannel.switchDefaultForSetup', { targetReleaseChannel: 'preview' }, { switchDefaultReleaseChannel: true }],
        ['daemon.takeOverManualRelayRuntimeForSetup', {}, { takeOverManualRelayRuntime: true }],
        ['daemon.replaceLocalBackgroundServices', {}, { replaceExistingServices: true }],
    ])('answers the %s consent prompt from the one setup-task owner', async (kind, extraData, expectedAnswer) => {
        modalSpies.confirm.mockReset();
        modalSpies.confirm.mockResolvedValue(true);

        const manual = createManualRunner();
        const hook = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner }));

        let taskId: string | undefined;
        await act(async () => {
            taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                activeRelayUrl: 'http://127.0.0.1:43123',
                activeWebappUrl: 'http://127.0.0.1:43123',
            }));
        });

        await act(async () => {
            manual.emitEvent(taskId!, {
                type: 'prompt',
                stepId: 'setup.thisComputer.preflight',
                message: 'Consent needed before setup continues',
                data: { kind, targetServerUrl: 'http://127.0.0.1:43123', ...extraData },
            });
        });
        await flushHookEffects({ cycles: 3, turns: 2 });

        expect(modalSpies.confirm).toHaveBeenCalledTimes(1);
        expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, expectedAnswer);
    });

    it('keeps daemon pairing failure scoped to the task instead of requesting Home auth follow-up', async () => {
        const manual = createManualRunner();
        const onNeedsAuth = vi.fn();
        const onSucceeded = vi.fn();
        const hook = await renderHook(() => useThisComputerSetupTask({
            runner: manual.runner,
            onNeedsAuth,
            onSucceeded,
        }));

        let taskId: string | undefined;
        await act(async () => {
            taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                activeRelayUrl: 'http://127.0.0.1:43123',
                activeWebappUrl: 'http://127.0.0.1:43123',
            }));
        });
        expect(taskId).toBeTruthy();

        await act(async () => {
            manual.emitResult(taskId!, {
                protocolVersion: 1,
                taskId: taskId!,
                ok: false,
                error: {
                    code: 'daemon_service_not_ready',
                    message: 'Background service is not ready yet.',
                },
            });
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(onNeedsAuth).not.toHaveBeenCalled();
        expect(onSucceeded).not.toHaveBeenCalled();
        expect(hook.getCurrent().activeTaskSnapshot?.result).toEqual(expect.objectContaining({
            ok: false,
            error: expect.objectContaining({ code: 'daemon_service_not_ready' }),
        }));
    });

    describe('blocking token-only pairing approval', () => {
        beforeEach(() => {
            approvalMocks.readCredentials.mockReset();
            approvalMocks.serverFetch.mockReset();
            approvalMocks.endpointFetch.mockReset();
            approvalMocks.createServerFetchAtEndpoint.mockReset();
            approvalMocks.createServerFetchAtEndpoint.mockImplementation(() => approvalMocks.endpointFetch);
            modalSpies.confirm.mockReset();
            modalSpies.confirm.mockResolvedValue(false);
        });

        const RESOLVED_CLI_COMMAND = '/home/dev/repo/apps/cli/bin/happier.mjs';

        function emitApprovalPrompt(
            manual: ReturnType<typeof createManualRunner>,
            taskId: string,
            relayUrl: string,
            cliProvenance: string | null = 'managed',
        ): void {
            manual.emitEvent(taskId, {
                type: 'prompt',
                stepId: 'setup.thisComputer.auth.request',
                message: 'Approve this computer in Happier to continue',
                data: {
                    kind: 'authRequest',
                    publicKey: 'pub-key-b64',
                    response: 'opaque-token-only-response-b64',
                    responseKind: 'tokenOnly',
                    relayUrl,
                    webappUrl: relayUrl,
                    cliCommand: RESOLVED_CLI_COMMAND,
                    ...(cliProvenance ? { cliProvenance } : {}),
                },
            });
        }

        it('approves through the explicit endpoint with the Home-scoped token and answers without credentials', async () => {
            approvalMocks.readCredentials.mockResolvedValue({ token: 'home-b-bearer' });
            approvalMocks.endpointFetch
                .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending', supportsV2: true }), { status: 200 }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                activeRelayUrl: 'http://127.0.0.1:43123',
                activeWebappUrl: 'http://127.0.0.1:43123',
            }));
            });
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.1:3005');
            await flushHookEffects({ cycles: 3, turns: 2 });

            // The Home-scoped credential is read for the prompt's explicit target only.
            expect(approvalMocks.readCredentials).toHaveBeenCalledWith(
                'http://127.0.0.1:3005',
                { serverId: 'srv_home_b' },
            );
            expect(approvalMocks.serverFetch).not.toHaveBeenCalled();
            const postCall = approvalMocks.endpointFetch.mock.calls.find(
                ([path]) => path === '/v1/auth/response',
            );
            expect(postCall).toBeTruthy();
            const init = postCall![1] as RequestInit;
            expect((init.headers as Record<string, string>).Authorization).toBe('Bearer home-b-bearer');
            // Exact body: the answer must carry no credential or claim material beyond what the
            // approve owner's contract defines. `authorizeUnattendedTeamAccess` is that owner's
            // decision for /v1/auth/response (`auth/flows/approve.ts`), asserted at
            // `approve.explicitEndpoint.test.ts`; it is repeated here only so this exact-shape
            // assertion stays a real leak check.
            expect(JSON.parse(String(init.body))).toEqual({
                publicKey: 'pub-key-b64',
                response: 'opaque-token-only-response-b64',
                responseKind: 'tokenOnly',
                authorizeUnattendedTeamAccess: true,
            });

            // The answer itself carries no credential or secret material.
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: true });
            // A managed CLI is approved silently: first-run onboarding asks the user nothing.
            expect(modalSpies.confirm).not.toHaveBeenCalled();
        });

        it('declines a token-only approval prompt whose explicit target identity does not match', async () => {
            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                activeRelayUrl: 'http://127.0.0.1:43123',
                activeWebappUrl: 'http://127.0.0.1:43123',
            }));
            });
            // An override-resolved CLI would normally be asked about; the binding check refuses first,
            // under its own name, so the mismatch never reads as a human decline.
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.9:9999', 'override');
            await flushHookEffects({ cycles: 3, turns: 2 });

            expect(modalSpies.confirm).not.toHaveBeenCalled();
            expect(approvalMocks.readCredentials).not.toHaveBeenCalled();
            expect(approvalMocks.createServerFetchAtEndpoint).not.toHaveBeenCalled();
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: false, reason: 'relay_mismatch' });
        });

        it('declines when no Home-scoped credential exists for the explicit target', async () => {
            approvalMocks.readCredentials.mockResolvedValue(null);

            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                activeRelayUrl: 'http://127.0.0.1:43123',
                activeWebappUrl: 'http://127.0.0.1:43123',
            }));
            });
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.1:3005');
            await flushHookEffects({ cycles: 3, turns: 2 });

            expect(approvalMocks.readCredentials).toHaveBeenCalledTimes(1);
            expect(approvalMocks.createServerFetchAtEndpoint).not.toHaveBeenCalled();
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: false, reason: 'credentials_unavailable' });
        });

        it.each(['owner-a', 'owner-b', null])('binds a late approval to the initiating account when current credential subject is %s', async (subject) => {
            const token = subject === null ? 'malformed-current-token'
                : `e30.${Buffer.from(JSON.stringify({ sub: subject })).toString('base64')}.signature`;
            approvalMocks.readCredentials.mockResolvedValue({ token });
            approvalMocks.endpointFetch
                .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending', supportsV2: true }), { status: 200 }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner,
                authRequestApproval: { expectedRelayUrl: 'https://initiating-home.example', serverId: 'initiating-home' },
            }));
            let taskId = '';
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                    activeRelayUrl: 'https://initiating-home.example', activeWebappUrl: 'https://initiating-home.example',
                    activeAccountId: 'owner-a',
                }));
            });
            await hook.unmount();
            emitApprovalPrompt(manual, taskId, 'https://initiating-home.example');
            await flushHookEffects({ cycles: 3, turns: 2 });
            if (subject === 'owner-a') {
                expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: true });
                expect(approvalMocks.endpointFetch.mock.calls.some(([path]) => path === '/v1/auth/response')).toBe(true);
            } else {
                expect(approvalMocks.createServerFetchAtEndpoint).not.toHaveBeenCalled();
                expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: false, reason: 'credentials_unavailable' });
            }
        });

        // R8/R13: install ownership selects the approval mode. A CLI the managed install path did
        // not place — an env/repo override, or a prompt that names no acquisition path at all — is
        // never approved unattended, but it is not a dead end either: the person at the keyboard
        // is asked exactly once, naming the command that is actually asking.
        it.each([
            ['an override-resolved CLI', 'override' as string | null],
            ['a prompt that states no acquisition path', null as string | null],
        ])('raises exactly one attended confirmation naming the resolved command for %s', async (_label, cliProvenance) => {
            approvalMocks.readCredentials.mockResolvedValue({ token: 'home-b-bearer' });
            approvalMocks.endpointFetch
                .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending', supportsV2: true }), { status: 200 }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
            modalSpies.confirm.mockResolvedValue(true);

            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                    activeRelayUrl: 'http://127.0.0.1:43123',
                    activeWebappUrl: 'http://127.0.0.1:43123',
                }));
            });
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.1:3005', cliProvenance);
            await flushHookEffects({ cycles: 3, turns: 2 });

            // Exactly one question, and it names the binary the person can actually judge.
            expect(modalSpies.confirm).toHaveBeenCalledTimes(1);
            expect(String(modalSpies.confirm.mock.calls[0]?.[1])).toContain(RESOLVED_CLI_COMMAND);
            // Accepting approves: credentials are read only after the human said yes.
            expect(approvalMocks.readCredentials).toHaveBeenCalledWith(
                'http://127.0.0.1:3005',
                { serverId: 'srv_home_b' },
            );
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: true });
        });

        it('declines by name when the confirmation is refused, without reading any credential', async () => {
            approvalMocks.readCredentials.mockResolvedValue({ token: 'home-b-bearer' });
            modalSpies.confirm.mockResolvedValue(false);

            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec({
                    activeRelayUrl: 'http://127.0.0.1:43123',
                    activeWebappUrl: 'http://127.0.0.1:43123',
                }));
            });
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.1:3005', 'override');
            await flushHookEffects({ cycles: 3, turns: 2 });

            expect(modalSpies.confirm).toHaveBeenCalledTimes(1);
            expect(approvalMocks.readCredentials).not.toHaveBeenCalled();
            expect(approvalMocks.createServerFetchAtEndpoint).not.toHaveBeenCalled();
            // Always answered, and by name, so the executor reports a human decline as exactly
            // that instead of waiting for a timeout.
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: false, reason: 'cli_not_approved' });
        });
    });
});
