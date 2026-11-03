import { describe, expect, it } from 'vitest';
import { resolveRolesSnapshotV1 } from '@happier-dev/protocol/prompts/roles/resolveRoleSelectionV1';
import { snapshotSessionRolesAtSpawnV1 } from '@happier-dev/protocol/prompts/roles/sessionRolesSnapshot';
import { createRoleSourceReaderV1 } from '@happier-dev/protocol/prompts/roles/accountRoleActions';
import { BUILT_IN_ROLES_V1 } from '@happier-dev/protocol/prompts/roles/builtInRolesV1';
import { buildRoleCatalog } from '@/sync/domains/roles/roleCatalog';
import type { RoleCatalogEntry } from '@/sync/domains/roles/roleCatalog';

import { buildSessionRoleInventory } from './sessionRoleInventory';

const inherited = snapshotSessionRolesAtSpawnV1({ leadSessionId: 'lead', roles: resolveRolesSnapshotV1({
    settingsOverrides: { builder: { roleId: 'builder', instructionsOverride: 'Inherited build instructions.' } },
}) });

// The Settings layer as the catalog projects it: every built-in role, no override of the reader's own.
const builtInEntries: RoleCatalogEntry[] = Object.entries(resolveRolesSnapshotV1({})).map(([roleId, role]) => ({
    roleId, source: 'built_in', role, viewOnly: false, migratedFromV0_2: false,
}));

describe('buildSessionRoleInventory', () => {
    it('compares concrete spawn engines with the same inherited default for built-in and external plugin Roles', async () => {
        const defaultEngine = { agentTargetKey: 'agent:example.agents/external', modelId: 'session-model' };
        const roleSourceInventory = await createRoleSourceReaderV1({ readPluginRoles: () => [{
            pluginId: 'example.roles', localId: 'reader', role: { ...BUILT_IN_ROLES_V1.scout, name: 'External reader' },
        }] })();
        const entries = buildRoleCatalog({ items: roleSourceInventory.entries, overrides: {} });
        const snapshot = snapshotSessionRolesAtSpawnV1({ leadSessionId: 'lead', roles: resolveRolesSnapshotV1({
            roleSourceInventory, defaultEngine,
            settingsOverrides: { reviewer: { roleId: 'reviewer', engine: { ...defaultEngine, modelId: 'review-model' } } },
        }) });
        const rows = buildSessionRoleInventory({ entries, catalogKnown: true, sessionRoles: snapshot, defaultEngine });
        expect(rows.find(row => row.roleId === 'plugin:example.roles/reader')?.kind).toBeNull();
        expect(rows.filter(row => row.kind !== null).map(row => [row.roleId, row.kind])).toEqual([['reviewer', 'changed']]);
    });

    it('reports only the inherited role that differs from Settings once the catalog is known', () => {
        const rows = buildSessionRoleInventory({ entries: builtInEntries, catalogKnown: true, sessionRoles: inherited });
        expect(rows.filter(row => row.kind !== null).map(row => [row.roleId, row.kind])).toEqual([['builder', 'changed']]);
    });

    it('does not mark a session override that preserves the inherited Role as changed', () => {
        const rows = buildSessionRoleInventory({ entries: builtInEntries, catalogKnown: true, sessionRoles: {
            overrides: { builder: { roleId: 'builder', workspaceWrites: 'allow' } }, sessionRoles: {}, notes: '',
        } });
        expect(rows.filter(row => row.kind !== null)).toEqual([]);
    });

    it('distinguishes matching and changed disabled Role snapshots even when neither can execute', () => {
        const roleId = 'disabled-reader';
        const entries = buildRoleCatalog({ items: [{ roleId, role: { ...BUILT_IN_ROLES_V1.scout, enabled: false },
            shared: false, viewOnly: false, migratedFromV0_2: false,
        }], overrides: {} });
        const snapshot = snapshotSessionRolesAtSpawnV1({ leadSessionId: 'lead', roles: { [roleId]: entries[0]!.role } });
        expect(buildSessionRoleInventory({ entries, catalogKnown: true, sessionRoles: snapshot })[0])
            .toMatchObject({ enabled: false, kind: null });
        const changed = snapshotSessionRolesAtSpawnV1({ leadSessionId: 'lead', roles: {
            [roleId]: { ...entries[0]!.role, instructions: 'Different inherited instructions.' },
        } });
        expect(buildSessionRoleInventory({ entries, catalogKnown: true, sessionRoles: changed })[0])
            .toMatchObject({ enabled: false, kind: 'changed' });
        expect(buildSessionRoleInventory({ entries, catalogKnown: true, sessionRoles: {
            ...snapshot, overrides: { [roleId]: { roleId, workspaceWrites: 'deny' } },
        } })[0]).toMatchObject({ enabled: false, kind: null });
        expect(buildSessionRoleInventory({ entries, catalogKnown: true, sessionRoles: {
            ...snapshot, overrides: { [roleId]: { roleId, workspaceWrites: 'allow' } },
        } })[0]).toMatchObject({ enabled: false, kind: 'changed' });
    });

    it('does not call every inherited role a session addition before the catalog is known', () => {
        const rows = buildSessionRoleInventory({ entries: [], catalogKnown: false, sessionRoles: inherited });
        expect(rows.filter(row => row.kind !== null)).toEqual([]);
    });

    it('still reports a session override while the catalog is unknown', () => {
        const rows = buildSessionRoleInventory({ entries: [], catalogKnown: false, sessionRoles: {
            ...inherited, overrides: { planner: { roleId: 'planner', workspaceWrites: 'deny' } },
        } });
        expect(rows.filter(row => row.kind !== null).map(row => [row.roleId, row.kind, row.reset])).toEqual([['planner', 'changed', 'override']]);
    });
});
