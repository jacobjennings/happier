import { describe, expect, it, vi } from 'vitest';

import { buildAccessEndpointProjection } from '@/sync/domains/accessEndpoints/buildProjection';
import { buildAccessChannelProjection } from '@/sync/domains/accessEndpoints/channels/buildProjection';

import { buildNativeSshTunnelKey, createNativeSshTunnelSupervisor } from './supervisor';
import type { NativeSshTunnelAdapter, NativeSshTunnelProbe } from './types';

function createRequest() {
    return {
        remoteHostId: 'host-a',
        sshTarget: 'dev@10.0.0.5',
        destinationHost: '127.0.0.1' as const,
        destinationPort: 3005,
        purpose: 'server-http' as const,
        credentialsRef: {
            remoteHostId: 'host-a',
            credentialId: 'cred-a',
            storage: 'session-memory' as const,
        },
    };
}

describe('native SSH tunnel supervisor', () => {
    it('reuses a ready lease only after a successful health probe, under the native-ssh lease identity', async () => {
        const adapter: NativeSshTunnelAdapter = {
            startLoopbackTunnel: vi.fn(async () => ({
                nativeTunnelId: 'native-1',
                localPort: 49152,
            })),
            stopLoopbackTunnel: vi.fn(async () => undefined),
        };
        const supervisor = createNativeSshTunnelSupervisor({ adapter, probe: vi.fn(async () => ({ ok: true as const })) });

        const firstLease = await supervisor.ensureTunnel(createRequest());
        const secondLease = await supervisor.ensureTunnel(createRequest());

        expect(secondLease.leaseId).toBe(firstLease.leaseId);
        expect(firstLease.leaseId).toBe(`native-ssh:${buildNativeSshTunnelKey(createRequest())}`);
        expect(adapter.startLoopbackTunnel).toHaveBeenCalledTimes(1);
    });

    // Cause -> platform limitation. Lease/probe/stop mechanics are owned and proven by the shared loopback supervisor.
    it.each([
        {
            cause: 'a post-start probe timeout',
            options: { probe: (async () => new Promise<never>(() => {})) as NativeSshTunnelProbe, probeTimeoutMs: 1 },
            startError: undefined,
            reason: 'remote-service-unreachable',
            rejection: 'native_ssh_tunnel_probe_failed',
            startsNative: true,
        },
        {
            cause: 'a captive-portal probe failure',
            options: { probe: async () => ({ ok: false as const, reason: 'network-captive-portal' as const }) },
            startError: undefined,
            reason: 'network-captive-portal',
            rejection: 'native_ssh_tunnel_probe_failed',
            startsNative: true,
        },
        {
            cause: 'a native start error code',
            options: { probe: async () => ({ ok: true as const }) },
            startError: Object.assign(new Error('Native SSH loopback bind failed.'), { code: 'loopback-bind-failed' }),
            reason: 'loopback-bind-failed',
            rejection: 'Native SSH loopback bind failed.',
            startsNative: false,
        },
    ])('exposes $cause as an error-severity platform limitation and leaves no lease', async ({ options, startError, reason, rejection, startsNative }) => {
        const adapter: NativeSshTunnelAdapter = {
            startLoopbackTunnel: vi.fn(async () => {
                if (startError) throw startError;
                return { nativeTunnelId: 'native-1', localPort: 49152 };
            }),
            stopLoopbackTunnel: vi.fn(async () => undefined),
        };
        const supervisor = createNativeSshTunnelSupervisor({ adapter, ...options });

        await expect(supervisor.ensureTunnel(createRequest())).rejects.toThrow(rejection);

        if (startsNative) expect(adapter.stopLoopbackTunnel).toHaveBeenCalledWith('native-1');
        expect(supervisor.listTunnels().leases).toEqual([]);
        expect(supervisor.listTunnels().platformLimitations).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason, severity: 'error' }),
        ]));
    });

    it('clears stale start diagnostics after a later successful tunnel', async () => {
        const error = Object.assign(new Error('Native SSH authentication failed.'), {
            code: 'authentication-failed',
        });
        const supervisor = createNativeSshTunnelSupervisor({
            adapter: {
                startLoopbackTunnel: vi.fn()
                    .mockRejectedValueOnce(error)
                    .mockResolvedValueOnce({ nativeTunnelId: 'native-1', localPort: 49152 }),
                stopLoopbackTunnel: vi.fn(async () => undefined),
            },
            probe: vi.fn(async () => ({ ok: true as const })),
        });

        await expect(supervisor.ensureTunnel(createRequest())).rejects.toThrow('Native SSH authentication failed.');
        expect(supervisor.listTunnels().platformLimitations.map((limitation) => limitation.reason))
            .toContain('authentication-failed');

        await supervisor.ensureTunnel(createRequest());

        expect(supervisor.listTunnels().platformLimitations.map((limitation) => limitation.reason))
            .not.toContain('authentication-failed');
    });

    it('normalizes SSH targets and exposes suspended platform limitations, rejecting starts while suspended', async () => {
        const key = buildNativeSshTunnelKey({
            ...createRequest(),
            sshTarget: 'dev@HOST.Example.COM',
        });
        expect(key).toBe(buildNativeSshTunnelKey({
            ...createRequest(),
            sshTarget: 'dev@host.example.com',
        }));
        expect(key).not.toContain('HOST.Example.COM');

        const adapter: NativeSshTunnelAdapter = {
            startLoopbackTunnel: vi.fn(async () => ({ nativeTunnelId: 'native-1', localPort: 49152 })),
            stopLoopbackTunnel: vi.fn(async () => undefined),
        };
        const supervisor = createNativeSshTunnelSupervisor({
            adapter,
            probe: vi.fn(async () => ({ ok: true as const })),
        });
        await supervisor.ensureTunnel(createRequest());
        supervisor.markSuspended();

        expect(supervisor.listTunnels().platformLimitations.map((limitation) => limitation.reason)).toEqual(expect.arrayContaining([
            'foreground-only',
            'platform-suspended',
        ]));
        expect(supervisor.listTunnels().platformLimitations.find((limitation) => limitation.reason === 'platform-suspended')?.message)
            .toBe('settings.accessEndpoints.limitation.platform-suspended');
        expect(supervisor.listTunnels().leases[0]?.status).toBe('degraded');

        // A different key proves the guard is the supervisor's, not lease reuse.
        await expect(supervisor.ensureTunnel({ ...createRequest(), sshTarget: 'dev@other.example.com' }))
            .rejects.toThrow('native_ssh_tunnel_suspended');
        expect(adapter.startLoopbackTunnel).toHaveBeenCalledTimes(1);
    });

    /**
     * §7.1 deciding check. An authentication failure aborts before any lease exists, so the whole
     * chain — supervisor limitation → snapshot → projection diagnostics → access channel — has to
     * carry it without an endpoint. Only the native adapter (a real system boundary) is faked.
     */
    it('surfaces an authentication failure all the way to an access channel with no lease', async () => {
        const authError = Object.assign(new Error('native_ssh_auth'), { code: 'authentication-failed' });
        const adapter: NativeSshTunnelAdapter = {
            startLoopbackTunnel: vi.fn(async () => {
                throw authError;
            }),
            stopLoopbackTunnel: vi.fn(async () => undefined),
        };
        const supervisor = createNativeSshTunnelSupervisor({
            adapter,
            probe: vi.fn(async () => ({ ok: true as const })),
        });

        await expect(supervisor.ensureTunnel(createRequest())).rejects.toBe(authError);

        const snapshot = supervisor.listTunnels();
        expect(snapshot.leases).toEqual([]);

        const projection = buildAccessEndpointProjection({
            clientContext: 'native',
            nativeSshTunnelSnapshot: snapshot,
        });
        expect(projection.endpoints).toEqual([]);
        expect(projection.diagnostics.map((diagnostic) => diagnostic.id))
            .toContain('native-ssh.authentication-failed');

        const channels = buildAccessChannelProjection({
            endpoints: projection.endpoints,
            diagnostics: projection.diagnostics,
        });
        expect(channels.map((channel) => channel.kind)).toEqual(['ssh-tunnel-native']);
        expect(channels[0]?.limitations).toContainEqual(expect.objectContaining({
            reason: 'authentication-failed',
            severity: 'error',
        }));
    });
});
