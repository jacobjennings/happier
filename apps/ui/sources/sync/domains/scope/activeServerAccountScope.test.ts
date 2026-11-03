import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileFindSeedHandoff } from '@/components/appShell/panes/fileFindSeedHandoff';
import { getActiveServerSnapshot, setActiveServer } from '@/sync/domains/server/serverRuntime';
import { removeServerProfile, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';
import {
    publishApplyingActiveServerId,
    publishAppliedActiveServerRuntimeAvailability,
    publishAppliedActiveServerSnapshot,
} from '@/sync/runtime/orchestration/appliedActiveServerRuntime';
import {
    captureActiveServerAccountScopeLifetime,
    getActiveServerAccountScope,
    retireActiveServerAccountScopeLifetime,
    selectActiveServerAccountScopeForServer,
} from './activeServerAccountScope';

// The applied-runtime producer and the real store are the inputs; the
// connection owner that would publish them is not loaded.
function setProfileScope(profileScope: null | { serverId: string; accountId: string }): void {
    storage.setState({ profileScope });
}

describe('getActiveServerAccountScope', () => {
    beforeEach(() => {
        publishAppliedActiveServerRuntimeAvailability(false);
        publishAppliedActiveServerSnapshot({ serverId: 'srv_identity', serverUrl: 'https://relay.example.test', generation: 0 });
    });

    afterEach(() => {
        retireActiveServerAccountScopeLifetime();
        storage.setState(storage.getInitialState(), true);
    });

    it('returns the active scope when both the snapshot and stored scope use the identity id', () => {
        setProfileScope({ serverId: 'srv_identity', accountId: 'account-1' });

        expect(getActiveServerAccountScope()).toEqual({
            serverId: 'srv_identity',
            accountId: 'account-1',
        });
    });

    it('qualifies active-only content reads to the requested Home without inferring a missing Home', () => {
        const scope = { serverId: 'srv_identity', accountId: 'account-a' };
        expect(selectActiveServerAccountScopeForServer(scope, ' srv_identity ')).toBe(scope);
        expect(selectActiveServerAccountScopeForServer(scope, 'other-home')).toBeNull();
        expect(selectActiveServerAccountScopeForServer(scope, null)).toBeNull();
        expect(selectActiveServerAccountScopeForServer(scope, '')).toBeNull();
        expect(selectActiveServerAccountScopeForServer(null, 'srv_identity')).toBeNull();
    });

    it('does not treat a legacy host-derived scope as active after the snapshot resolves to identity', () => {
        setProfileScope({ serverId: 'localhost-18829', accountId: 'account-1' });

        expect(getActiveServerAccountScope()).toBeNull();
    });

    it('retires a captured Account lifetime synchronously before cancellation callbacks and isolates callback failures', () => {
        setProfileScope({ serverId: 'srv_identity', accountId: 'account-a' });

        const lifetime = captureActiveServerAccountScopeLifetime();
        expect(lifetime).not.toBeNull();
        if (!lifetime) throw new Error('Expected Account A lifetime.');
        expect(captureActiveServerAccountScopeLifetime()).toBe(lifetime);
        expect(lifetime.scope).toEqual({ serverId: 'srv_identity', accountId: 'account-a' });
        expect(lifetime.isCurrent()).toBe(true);

        const calls: string[] = [];
        lifetime.onRetire(() => {
            expect(lifetime.isCurrent()).toBe(false);
            calls.push('failing');
            throw new Error('one consumer failed');
        });
        lifetime.onRetire(() => {
            expect(lifetime.isCurrent()).toBe(false);
            calls.push('later');
        });
        const removed = lifetime.onRetire(() => { calls.push('removed'); });
        removed.dispose();
        removed.dispose();

        retireActiveServerAccountScopeLifetime();
        retireActiveServerAccountScopeLifetime();

        expect(lifetime.isCurrent()).toBe(false);
        expect(calls).toEqual(['failing', 'later']);

        lifetime.onRetire(() => { calls.push('late'); });
        expect(calls).toEqual(['failing', 'later', 'late']);
    });

    it('does not reuse a captured lifetime across an Account change with the same server', () => {
        setProfileScope({ serverId: 'srv_identity', accountId: 'account-a' });

        const accountA = captureActiveServerAccountScopeLifetime();
        expect(accountA).not.toBeNull();
        if (!accountA) throw new Error('Expected Account A lifetime.');

        setProfileScope({ serverId: 'srv_identity', accountId: 'account-b' });
        const accountB = captureActiveServerAccountScopeLifetime();

        expect(accountA.isCurrent()).toBe(false);
        expect(accountB).not.toBeNull();
        expect(accountB).not.toBe(accountA);
        expect(accountB?.scope).toEqual({ serverId: 'srv_identity', accountId: 'account-b' });
        expect(accountB?.isCurrent()).toBe(true);
    });

    it('retires pending file Find seeds and rejects a different Home with the same Account id', () => {
        setProfileScope({ serverId: 'srv_identity', accountId: 'account-a' });
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (!lifetime) throw new Error('Expected current Account lifetime.');
        const handoff = createFileFindSeedHandoff();
        const destination = { host: 'project' as const, id: 'project-a', accountId: 'account-a', path: 'src/a.ts',
            scope: { serverId: 'srv_identity', machineId: 'machine-a', rootPath: '/repo' } };
        const seed = { query: 'needle', options: { matchCase: false, regex: false }, target: { kind: 'file' as const, path: destination.path } };
        const wrongHome = { ...destination, scope: { ...destination.scope, serverId: 'other-home' } };
        handoff.stage(wrongHome, seed, lifetime);
        expect(handoff.peek(wrongHome)).toBeNull();
        handoff.stage(destination, seed, lifetime);
        expect(handoff.peek(destination)).toEqual(seed);
        retireActiveServerAccountScopeLifetime();
        expect(handoff.peek(destination)).toBeNull();
    });

    it('keeps the applied lifetime while another Home is only staged, and the applying producer retires it', async () => {
        setProfileScope({ serverId: 'srv_identity', accountId: 'account-a' });
        const accountA = captureActiveServerAccountScopeLifetime();
        if (!accountA) throw new Error('Expected Account A lifetime.');
        const retired = vi.fn();
        accountA.onRetire(retired);

        const next = await upsertServerProfile({ serverUrl: 'https://staged-next.example.test' });
        try {
            // Staging: the device selection moves, the applied runtime has not.
            await setActiveServer({ serverId: next.id });
            expect(getActiveServerSnapshot().serverId).toBe(next.id);
            expect(captureActiveServerAccountScopeLifetime()).toBe(accountA);
            expect(accountA.isCurrent()).toBe(true);
            expect(retired).not.toHaveBeenCalled();

            // Applying: the producer retires Account A itself, before any reader captures again.
            publishApplyingActiveServerId(next.id, 1);
            expect(retired).toHaveBeenCalledOnce();
            expect(accountA.isCurrent()).toBe(false);
            expect(captureActiveServerAccountScopeLifetime()).toBeNull();

            publishAppliedActiveServerSnapshot({ serverId: next.id, serverUrl: next.serverUrl, generation: 1 });
            setProfileScope({ serverId: next.id, accountId: 'account-b' });
            const accountB = captureActiveServerAccountScopeLifetime();
            expect(accountB).not.toBeNull();
            expect(accountB).not.toBe(accountA);
            expect(accountB?.scope).toEqual({ serverId: next.id, accountId: 'account-b' });
        } finally {
            await removeServerProfile(next.id);
        }
    });
});
