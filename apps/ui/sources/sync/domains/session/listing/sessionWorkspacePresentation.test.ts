import { describe, expect, it } from 'vitest';

import { resolveSessionWorkspacePresentation } from './sessionWorkspacePresentation';

const machines = {
    m1: {
        id: 'm1',
        active: true,
        activeAt: 0,
        updatedAt: 0,
        revokedAt: null,
        metadataVersion: 1,
        metadata: {
            host: 'machine',
            homeDir: '/Users/lee',
        },
    },
};

describe('resolveSessionWorkspacePresentation', () => {
    it('groups task workspaces by the explicit project while preserving custom labels', () => {
        const projectGroupV1 = { v: 1 as const, path: '/Users/lee/projects/happier', label: 'Happier' };
        const first = resolveSessionWorkspacePresentation({ scope: 'project',
            metadata: { machineId: 'm1', path: '/Users/lee/ws/task-a', projectGroupV1 },
            target: { machineId: 'm1', basePath: '/Users/lee/ws/task-a' },
            machines,
        });
        const second = resolveSessionWorkspacePresentation({ scope: 'project',
            metadata: { machineId: 'm1', path: '/Users/lee/ws/task-b', projectGroupV1 },
            machines,
            workspaceLabelsV1: { [first.workspaceKey]: 'My project' },
        });
        expect(first.pathKey).toBe('/Users/lee/projects/happier');
        expect(first.displayTitle).toBe('Happier');
        expect(second.groupKey).toBe(first.groupKey);
        expect(second.displayTitle).toBe('My project');
        const legacy = resolveSessionWorkspacePresentation({ scope: 'project',
            metadata: { machineId: 'm1', path: '/Users/lee/ws/task-a' }, machines,
        });
        expect(legacy.groupKey).not.toBe(first.groupKey);
        expect(legacy.displayTitle).toBe('task-a');
        expect(resolveSessionWorkspacePresentation({
            metadata: { machineId: 'm1', path: '/Users/lee/ws/task-a', projectGroupV1 }, machines,
        }).displayTitle).toBe('task-a');
    });

    it('uses the project basename and ignores malformed grouping hints', () => {
        const metadata = { machineId: 'm1', path: '/Users/lee/ws/task-a' };
        expect(resolveSessionWorkspacePresentation({ scope: 'project', metadata: {
            ...metadata, projectGroupV1: { v: 1, path: '/Users/lee/projects/happier' },
        }, machines }).displayTitle).toBe('happier');
        expect(resolveSessionWorkspacePresentation({ scope: 'project', metadata: {
            ...metadata, projectGroupV1: { v: 2, path: '/Users/lee/projects/happier' },
        }, machines }).displayTitle).toBe('task-a');
    });

    it('uses the workspace basename as the default display title while preserving the display path', () => {
        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
        });

        expect(presentation.displayPath).toBe('~/Documents/Development/happier/remote-dev');
        expect(presentation.displayTitle).toBe('remote-dev');
    });

    it('keeps custom workspace labels above basename and full-path display settings', () => {
        const base = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
        });

        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
            workspaceLabelsV1: {
                [base.workspaceKey]: 'Preview app',
            },
            workspacePathDisplayModeV1: 'path',
        });

        expect(presentation.displayTitle).toBe('Preview app');
        expect(presentation.hasCustomLabel).toBe(true);
    });

    it('can display the formatted full path when the account setting requests it', () => {
        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
            workspacePathDisplayModeV1: 'path',
        });

        expect(presentation.displayTitle).toBe('~/Documents/Development/happier/remote-dev');
    });
});
