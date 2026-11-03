import { describe, expect, it } from 'vitest';

import {
    createInitialIrohHomeTransportDiagnostics,
    projectIrohHomeTransportDiagnosticsEvent,
} from './diagnostics';

describe('native Iroh Home transport diagnostics projection', () => {
    it('retains exact applied configuration and sanitizes relay URLs', () => {
        const snapshot = createInitialIrohHomeTransportDiagnostics({
            homeServerIdentityId: 'home_1',
            remoteEndpointId: 'a'.repeat(64),
            policy: 'automatic',
            relayUrls: ['https://user:secret@relay.example.test/path?token=secret#fragment'],
            directAddresses: ['192.0.2.10:4433'],
            atMs: 10,
        });

        expect(snapshot).toMatchObject({
            homeServerIdentityId: 'home_1',
            remoteEndpointId: 'a'.repeat(64),
            state: 'connecting',
            effectiveConfiguration: {
                policy: 'automatic',
                relayUrls: ['https://relay.example.test/path'],
                directAddressCount: 1,
            },
            lastTransitionAtMs: 10,
        });
        expect(snapshot.current).toBeUndefined();
        expect(JSON.stringify(snapshot)).not.toContain('secret');
    });

    it('bounds copied relay details without truncating the reported applied configuration', () => {
        const relayUrls = Array.from(
            { length: 17 },
            (_, index) => `https://relay-${index}.example.test`,
        );
        const directAddresses = Array.from(
            { length: 300 },
            (_, index) => `192.0.2.${index % 255}:${4_000 + index}`,
        );

        const snapshot = createInitialIrohHomeTransportDiagnostics({
            homeServerIdentityId: 'home_large_configuration',
            remoteEndpointId: 'a'.repeat(64),
            policy: 'automatic',
            relayUrls,
            directAddresses,
            atMs: 10,
        });

        expect(snapshot.effectiveConfiguration).toEqual({
            policy: 'automatic',
            relayUrls: relayUrls.slice(0, 16),
            relayUrlCount: 17,
            relayUrlsTruncated: true,
            directAddressCount: 300,
        });
    });

    it('distinguishes current observations from last-known facts after degradation', () => {
        const initial = createInitialIrohHomeTransportDiagnostics({
            homeServerIdentityId: 'home_1',
            remoteEndpointId: 'a'.repeat(64),
            policy: 'disabled',
            atMs: 10,
        });
        const ready = projectIrohHomeTransportDiagnosticsEvent(initial, {
            type: 'ready',
            observedPath: 'direct',
            atMs: 20,
        });
        const degraded = projectIrohHomeTransportDiagnosticsEvent(ready, {
            type: 'degraded',
            errorCode: 'transport_timeout',
            atMs: 30,
        });

        expect(degraded).toMatchObject({
            state: 'reconnecting',
            lastKnown: { carrier: 'iroh', observedPath: 'direct' },
            diagnosticError: { code: 'transport_timeout', atMs: 30 },
            lastTransitionAtMs: 30,
        });
        expect(degraded.current).toBeUndefined();
    });

    it('never infers direct or relay when native reports unknown', () => {
        const initial = createInitialIrohHomeTransportDiagnostics({
            homeServerIdentityId: 'home_1',
            remoteEndpointId: 'a'.repeat(64),
            policy: 'automatic',
            atMs: 10,
        });
        const ready = projectIrohHomeTransportDiagnosticsEvent(initial, {
            type: 'ready',
            observedPath: 'unknown',
            atMs: 20,
        });

        expect(ready.state).toBe('connected');
        expect(ready.current).toEqual({ carrier: 'iroh' });
        expect(ready.lastKnown).toEqual({ carrier: 'iroh' });
    });
});
