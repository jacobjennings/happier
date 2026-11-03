import { afterEach, describe, expect, it, vi } from 'vitest';

import * as profiles from '../serverProfiles';
import { ALL_HOMES_SELECTION_TARGET_ID } from './allHomesSelectionTarget';
import * as selection from './homeViewSelectionState';
import type { ServerSelectionGroup } from './serverSelectionTypes';

function randomScope(): string {
    return `home_view_selection_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stubWebRuntime(origin: string): void {
    const local = new Map<string, string>();
    const session = new Map<string, string>();
    const storage = (values: Map<string, string>) => ({
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, String(value)),
        removeItem: (key: string) => void values.delete(key),
        clear: () => void values.clear(),
    });
    const lockTails = new Map<string, Promise<void>>();

    vi.stubGlobal('sessionStorage', storage(session));
    vi.stubGlobal('window', {
        location: { origin, hostname: new URL(origin).hostname },
        localStorage: storage(local),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {
        locks: {
            request: <T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> => {
                const previous = lockTails.get(name) ?? Promise.resolve();
                const result = previous.then(callback);
                lockTails.set(name, result.then(() => undefined, () => undefined));
                return result;
            },
        },
    });
}

describe('updateEffectiveHomeViewState', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        vi.unstubAllGlobals();
        profiles.resetServerProfilesRuntimeForTests();
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
    });

    it('evaluates a device updater against the latest persisted state inside the Web Lock', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');
        const homeA = await profiles.upsertServerProfile({ serverUrl: 'https://a.example.test', name: 'A' });
        const homeB = await profiles.upsertServerProfile({ serverUrl: 'https://b.example.test', name: 'B' });
        const originalGroup = { id: 'original', name: 'Original', serverIds: [homeA.id], presentation: 'grouped' as const };
        const latestGroup = { id: 'latest', name: 'Latest', serverIds: [homeB.id], presentation: 'grouped' as const };
        const appendedGroup = { id: 'appended', name: 'Appended', serverIds: [homeA.id, homeB.id], presentation: 'grouped' as const };
        await profiles.saveHomeViewState({
            version: 1,
            groups: [originalGroup],
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
        });

        const firstMutation = profiles.updateHomeViewState((current) => ({ ...current, groups: [latestGroup] }));
        let observedGroups: readonly ServerSelectionGroup[] | null = null;
        const secondMutation = selection.updateEffectiveHomeViewState((current) => {
            observedGroups = [...current.groups];
            return { ...current, groups: [...current.groups, appendedGroup] };
        }, { scope: 'device' });

        await Promise.all([firstMutation, secondMutation]);

        expect(observedGroups).toEqual([latestGroup]);
        expect(profiles.loadHomeViewState()?.groups).toEqual([latestGroup, appendedGroup]);
    });

    it('keeps an explicit All Homes target for the device and for a tab', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');
        const homeA = await profiles.upsertServerProfile({ serverUrl: 'https://a.example.test', name: 'A' });
        await profiles.upsertServerProfile({ serverUrl: 'https://b.example.test', name: 'B' });
        await profiles.saveHomeViewState({
            version: 1,
            groups: [],
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
        });

        await selection.updateEffectiveHomeViewState((current) => ({
            ...current,
            activeTargetKind: 'group',
            activeTargetId: ALL_HOMES_SELECTION_TARGET_ID,
        }), { scope: 'device' });
        expect(profiles.loadHomeViewState()).toMatchObject({
            activeTargetKind: 'group',
            activeTargetId: ALL_HOMES_SELECTION_TARGET_ID,
        });

        await selection.updateEffectiveHomeViewState((current) => ({
            ...current,
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
        }), { scope: 'device' });
        await selection.updateEffectiveHomeViewState((current) => ({
            ...current,
            activeTargetKind: 'group',
            activeTargetId: ALL_HOMES_SELECTION_TARGET_ID,
        }), { scope: 'tab' });
        expect(selection.loadEffectiveHomeViewState()).toMatchObject({
            activeTargetKind: 'group',
            activeTargetId: ALL_HOMES_SELECTION_TARGET_ID,
        });
    });

    it('keeps the latest device groups while a tab updater changes only its session target', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');
        const homeA = await profiles.upsertServerProfile({ serverUrl: 'https://a.example.test', name: 'A' });
        const homeB = await profiles.upsertServerProfile({ serverUrl: 'https://b.example.test', name: 'B' });
        const originalGroup = { id: 'original', name: 'Original', serverIds: [homeA.id], presentation: 'grouped' as const };
        const latestGroup = { id: 'latest', name: 'Latest', serverIds: [homeA.id, homeB.id], presentation: 'grouped' as const };
        await profiles.saveHomeViewState({
            version: 1,
            groups: [originalGroup],
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
        });

        const deviceMutation = profiles.updateHomeViewState((current) => ({ ...current, groups: [latestGroup] }));
        // A routine selection: it carries the groups it was handed and changes only the target.
        const tabMutation = selection.updateEffectiveHomeViewState((current) => ({
            ...current,
            activeTargetKind: 'server',
            activeTargetId: homeB.id,
        }), { scope: 'tab' });

        await Promise.all([deviceMutation, tabMutation]);

        expect(profiles.loadHomeViewState()).toMatchObject({
            groups: [latestGroup],
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
        });
        expect(selection.loadEffectiveHomeViewState()).toMatchObject({
            groups: [latestGroup],
            activeTargetKind: 'server',
            activeTargetId: homeB.id,
        });
    });

    it('persists a browser tab\'s group edit device-wide while activating it only in that tab', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');
        const homeA = await profiles.upsertServerProfile({ serverUrl: 'https://a.example.test', name: 'A' });
        const homeB = await profiles.upsertServerProfile({ serverUrl: 'https://b.example.test', name: 'B' });
        const existingGroup = { id: 'existing', name: 'Existing', serverIds: [homeA.id], presentation: 'grouped' as const };
        const concurrentGroup = { id: 'concurrent', name: 'Concurrent', serverIds: [homeB.id], presentation: 'grouped' as const };
        const createdGroup = { id: 'created', name: 'Created', serverIds: [homeA.id, homeB.id], presentation: 'grouped' as const };
        await profiles.saveHomeViewState({
            version: 1,
            groups: [existingGroup],
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
        });

        // Another surface adds a group while this tab's create is being committed.
        const concurrentMutation = profiles.updateHomeViewState((current) => ({
            ...current,
            groups: [...current.groups, concurrentGroup],
        }));
        // The create updater the Settings group action submits in tab scope.
        const createMutation = selection.updateEffectiveHomeViewState((current) => ({
            ...current,
            groups: [...current.groups, createdGroup],
            activeTargetKind: 'group',
            activeTargetId: createdGroup.id,
        }), { scope: 'tab' });
        await Promise.all([concurrentMutation, createMutation]);

        // Group definitions are device-global: the create persisted beside the concurrent edit.
        expect(profiles.loadHomeViewState()).toMatchObject({
            groups: [existingGroup, concurrentGroup, createdGroup],
            // The device default is not a routine browser selection's to change.
            activeTargetKind: 'server',
            activeTargetId: homeA.id,
        });
        expect(selection.loadEffectiveHomeViewState()).toMatchObject({
            activeTargetKind: 'group',
            activeTargetId: createdGroup.id,
        });

        // Rename and remove from the tab persist too.
        await selection.updateEffectiveHomeViewState((current) => ({
            ...current,
            groups: current.groups.map((group) => group.id === existingGroup.id ? { ...group, name: 'Renamed' } : group),
        }), { scope: 'tab' });
        await selection.updateEffectiveHomeViewState((current) => ({
            ...current,
            groups: current.groups.filter((group) => group.id !== concurrentGroup.id),
        }), { scope: 'tab' });
        expect(profiles.loadHomeViewState()?.groups).toEqual([
            { ...existingGroup, name: 'Renamed' },
            createdGroup,
        ]);
        expect(selection.loadEffectiveHomeViewState()).toMatchObject({
            activeTargetKind: 'group',
            activeTargetId: createdGroup.id,
        });
    });
});
