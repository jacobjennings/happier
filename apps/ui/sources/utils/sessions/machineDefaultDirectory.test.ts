import { describe, expect, it } from 'vitest';

import type { Machine } from '@/sync/domains/state/storageTypes';

import { resolveDefaultDirectoryForMachine } from './machineDefaultDirectory';

function machine(id: string, homeDir: string | null): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: homeDir === null ? null : {
            host: `${id}.local`,
            platform: 'linux',
            happyCliVersion: '0.0.0-test',
            happyHomeDir: `${homeDir}/.happier`,
            homeDir,
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

const machines = [machine('machine-1', '/home/dev'), machine('machine-2', null)];

describe('default directory for a Machine', () => {
    it('prefers the most recent folder over the home directory', () => {
        expect(resolveDefaultDirectoryForMachine({
            machineId: 'machine-1',
            machines,
            recentPaths: ['/home/dev/repo', '/home/dev/other'],
        })).toBe('/home/dev/repo');
    });

    it('falls back to the home directory for a Machine with no history', () => {
        expect(resolveDefaultDirectoryForMachine({
            machineId: 'machine-1',
            machines,
            recentPaths: ['   '],
        })).toBe('/home/dev');
    });

    it('stays visibly unresolved when neither is known', () => {
        expect(resolveDefaultDirectoryForMachine({
            machineId: 'machine-2',
            machines,
            recentPaths: [],
        })).toBe('');
        expect(resolveDefaultDirectoryForMachine({
            machineId: null,
            machines,
            recentPaths: ['/home/dev/repo'],
        })).toBe('');
    });
});
