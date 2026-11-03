import { afterEach, describe, expect, it, vi } from 'vitest';

import { installRepositoryScmCommonModuleMocks } from './repositoryScmTestHelpers';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';

const storageGetStateMock = vi.hoisted(() => vi.fn());

installRepositoryScmCommonModuleMocks({
    storage: async () => createStorageModuleStub({
        storage: {
            getState: storageGetStateMock,
        },
    }),
});

describe('resolveRepoScmSessionRequest', () => {
    it('qualifies repository identity and resolves the selected Home path without active-Home project fallback', async () => {
        const session = createSessionFixture({
            id: 'same-session', serverId: 'home-b', active: true,
            metadata: { machineId: 'same-machine', path: '~/repo', homeDir: '/home/b', host: 'b' },
        });
        const homeAMachineMetadata = {
            host: 'tester.local',
            platform: 'darwin',
            happyCliVersion: '0.0.0-test',
            happyHomeDir: '/Users/tester/.happy-dev',
            homeDir: '/home/a',
        };
        storageGetStateMock.mockReturnValue({
            sessions: { 'same-session': createSessionFixture({ id: 'same-session', serverId: 'home-a' }) },
            machines: { 'same-machine': createMachineFixture({ id: 'same-machine', active: true, metadata: homeAMachineMetadata }) },
            sessionListRowsByServerId: { 'home-b': { 'same-session': buildSessionListRenderableFromSession(session) } },
            machineListByServerId: { 'home-b': [createMachineFixture({ id: 'same-machine', active: true })] },
        });
        const { resolveRepoScmSessionRequest } = await import('./resolveRepoScmSessionRequest');
        expect(resolveRepoScmSessionRequest({ sessionId: 'same-session', serverId: 'home-b' }))
            .toMatchObject({ machineId: 'same-machine', resolvedPath: '/home/b/repo', repoIdentityKey: 'server:"home-b":machine:"same-machine":/home/b/repo' });
        expect(resolveRepoScmSessionRequest({ sessionId: 'same-session', serverId: 'missing-home' })).toBeNull();
    });
    afterEach(() => {
        storageGetStateMock.mockReset();
        storageGetStateMock.mockReturnValue({});
        vi.restoreAllMocks();
    });

    it('resolves the canonical machine/path identity for a session-backed repo', async () => {
        storageGetStateMock.mockReturnValue({
            machines: {
                'machine-a': {
                    id: 'machine-a',
                    active: true,
                    activeAt: 42,
                    metadata: {
                        homeDir: '/Users/tester',
                        host: 'mbp.local',
                    },
                },
            },
            sessions: {
                session_1: {
                    id: 'session_1',
                    active: false,
                    updatedAt: 100,
                    metadata: {
                        machineId: 'machine-a',
                        host: 'mbp.local',
                    },
                },
            },
            getProjectForSession: (sessionId: string) => sessionId === 'session_1'
                ? {
                    key: {
                        machineId: 'machine-a',
                        rootPath: '/Users/tester/repo',
                    },
                }
                : null,
        } as any);

        const { resolveRepoScmSessionRequest } = await import('./resolveRepoScmSessionRequest');
        expect(resolveRepoScmSessionRequest({ sessionId: 'session_1' })).toEqual({
            sessionId: 'session_1',
            machineId: 'machine-a',
            resolvedPath: '/Users/tester/repo',
            repoIdentityKey: 'machine-a:/Users/tester/repo',
        });
    });

    it('resolves direct-session machine/path identity when only the direct link has a machine id', async () => {
        storageGetStateMock.mockReturnValue({
            machines: {
                'machine-other': {
                    id: 'machine-other',
                    active: true,
                    activeAt: 50,
                    metadata: {
                        homeDir: '/Users/other',
                        host: 'other.local',
                    },
                },
                'machine-direct': {
                    id: 'machine-direct',
                    active: false,
                    activeAt: 1,
                    metadata: {
                        homeDir: '/Users/tester',
                        host: 'direct.local',
                    },
                },
            },
            sessions: {
                session_direct: {
                    id: 'session_direct',
                    active: false,
                    updatedAt: 100,
                    metadata: {
                        path: '~/repo',
                        homeDir: '/Users/tester',
                        externalSessionV1: {
                            v: 1,
                            agentId: 'codex',
                            machineId: 'machine-direct',
                            remoteSessionId: 'remote-1',
                            source: { kind: 'codexHome', home: 'user' },
                        },
                    },
                },
            },
            getProjectForSession: () => null,
        } as any);

        const { resolveRepoScmSessionRequest } = await import('./resolveRepoScmSessionRequest');
        expect(resolveRepoScmSessionRequest({ sessionId: 'session_direct' })).toEqual({
            sessionId: 'session_direct',
            machineId: 'machine-direct',
            resolvedPath: '/Users/tester/repo',
            repoIdentityKey: 'machine-direct:/Users/tester/repo',
        });
    });
});
