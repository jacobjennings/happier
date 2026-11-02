import { describe, expect, it } from 'vitest';

describe('sessionListProjectGroupingKeys', () => {
    it('groups explicit projects while keeping managed Chats outside path groups', async () => {
        const { resolveSessionProjectGroupingKeyPartsWithMachineMetadata: resolve } = await import('./sessionListProjectGroupingKeys');
        const projectGroupV1 = { v: 1, path: '/repo', label: 'Project' };
        expect(resolve({ path: '/repo-task', machineId: 'm1', projectGroupV1 }, null, '/repo-task').pathKey).toBe('/repo');
        expect(resolve({ path: '/repo-task', projectGroupV1: { v: 2, path: '/wrong' } }, null).pathKey).toBe('/repo-task');
        expect(resolve({ path: '/private', projectGroupV1, sessionDirectoryV1: { v: 1, kind: 'managed' } }, null).pathKey).toBe('');
    });
    it('normalizes windows separators and expands ~ using homeDir without grouping by host', async () => {
        const { resolveSessionProjectGroupingKeyParts } = await import('./sessionListProjectGroupingKeys');
        const parts = resolveSessionProjectGroupingKeyParts({
            host: 'example',
            machineId: 'm1',
            homeDir: 'C:\\Users\\Bob\\',
            path: '~\\repo\\',
        });

        expect(parts.homeDir).toBe('C:/Users/Bob');
        expect(parts.pathKey).toBe('C:/Users/Bob/repo');
        expect(parts.machineGroupId).toBe('id:m1');
    });

    it('does not use host as a legacy grouping identity when machine id is missing', async () => {
        const { resolveSessionProjectGroupingKeyParts } = await import('./sessionListProjectGroupingKeys');
        const parts = resolveSessionProjectGroupingKeyParts({
            host: ' DEVBOX.local ',
            path: '/repo',
        });

        expect(parts.host).toBe('devbox');
        expect(parts.machineGroupId).toBe('unknown');
    });

    it('preserves UNC/network share prefixes when normalizing slashes', async () => {
        const { resolveSessionProjectGroupingKeyParts } = await import('./sessionListProjectGroupingKeys');
        const parts = resolveSessionProjectGroupingKeyParts({
            host: 'example',
            machineId: 'm1',
            path: '\\\\server\\share\\repo\\',
        });

        expect(parts.pathKey).toBe('//server/share/repo');
        expect(parts.machineGroupId).toBe('id:m1');
    });

    it('prefers machine metadata when deriving session project grouping key parts', async () => {
        const { resolveSessionProjectGroupingKeyPartsWithMachineMetadata } = await import('./sessionListProjectGroupingKeys');
        const parts = resolveSessionProjectGroupingKeyPartsWithMachineMetadata(
            {
                host: 'session-host',
                machineId: 'm1',
                homeDir: '/home/session',
                path: '~/repo',
            },
            {
                host: ' machine-host ',
                homeDir: '/home/machine/',
            },
            '~/repo',
        );

        expect(parts).toEqual({
            displayPath: '~/repo',
            machineGroupId: 'id:m1',
            host: 'machine-host',
            machineId: 'm1',
            homeDir: '/home/machine',
            pathKey: '/home/machine/repo',
            bucket: 'path',
        });
    });

    it('normalizes machine metadata host names before deriving grouping ids', async () => {
        const { resolveSessionProjectGroupingKeyPartsWithMachineMetadata } = await import('./sessionListProjectGroupingKeys');
        const parts = resolveSessionProjectGroupingKeyPartsWithMachineMetadata(
            {
                host: 'session-host',
                machineId: 'm1',
                path: '/repo',
            },
            {
                host: ' MACHINE-HOST.local ',
            },
        );

        expect(parts.host).toBe('machine-host');
        expect(parts.machineGroupId).toBe('id:m1');
    });

    it('builds one stable exact Home, Machine, and path identity', async () => {
        const {
            buildSessionProjectGroupingIdentity,
            sessionProjectGroupingIdentityKey,
            resolveSessionProjectGroupingKeyParts,
            resolveSessionProjectGroupingKeyPartsWithMachineMetadata,
        } = await import(
            './sessionListProjectGroupingKeys'
        );
        const first = resolveSessionProjectGroupingKeyParts({
            host: ' example ',
            machineId: 'm1',
            homeDir: '/home/u/',
            path: '~/repo/',
        });
        const second = resolveSessionProjectGroupingKeyParts({
            host: 'example',
            machineId: 'm1',
            homeDir: '/home/u',
            path: '~/repo',
        });
        const firstWithMachine = resolveSessionProjectGroupingKeyPartsWithMachineMetadata(
            {
                host: ' example ',
                machineId: 'm1',
                homeDir: '/home/u/',
                path: '~/repo',
            },
            {
                host: ' machine-host ',
                homeDir: '/home/machine/',
            },
            '~/repo',
        );
        const secondWithMachine = resolveSessionProjectGroupingKeyPartsWithMachineMetadata(
            {
                host: 'example',
                machineId: 'm1',
                homeDir: '/home/u',
                path: '~/repo',
            },
            {
                host: 'machine-host',
                homeDir: '/home/machine',
            },
            '~/repo',
        );

        expect(first).toEqual(second);
        expect(firstWithMachine).toEqual(secondWithMachine);

        const firstIdentity = buildSessionProjectGroupingIdentity(' home-a ', firstWithMachine);
        const secondIdentity = buildSessionProjectGroupingIdentity('home-a', secondWithMachine);
        expect(firstIdentity).toEqual(['home-a', 'm1', '/home/machine/repo']);
        expect(secondIdentity).toEqual(firstIdentity);
        expect(sessionProjectGroupingIdentityKey(secondIdentity)).toBe(
            sessionProjectGroupingIdentityKey(firstIdentity),
        );
    });

    it('keeps delimiter and NUL-bearing tuple parts distinct', async () => {
        const {
            buildSessionProjectGroupingIdentity,
            sessionProjectGroupingIdentityKey,
        } = await import('./sessionListProjectGroupingKeys');

        const key = (serverId: string, machineId: string, pathKey: string) =>
            sessionProjectGroupingIdentityKey(buildSessionProjectGroupingIdentity(serverId, {
                machineId,
                pathKey,
            }));

        expect(key('home', 'machine', '/repo:part')).not.toBe(
            key('home', 'machine:/repo', 'part'),
        );
        expect(key('home\u0000part', 'machine', '/repo')).not.toBe(
            key('home', 'part\u0000machine', '/repo'),
        );
        expect(key('home', 'machine\u0000part', '/repo')).not.toBe(
            key('home', 'machine', 'part\u0000/repo'),
        );
        expect(key('', 'machine', '/repo')).not.toBe(
            key('__unknown_server__', 'machine', '/repo'),
        );
    });
});
