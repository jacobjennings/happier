import { describe, expect, it, vi } from 'vitest';

import { readCurrentAppRuntimeInfo } from './readCurrentAppRuntimeInfo';

// Expo native modules are the boundary; the module under test reads them at call time, so one hoisted mutable
// state per scenario replaces three cold module reloads.
const expo = vi.hoisted(() => ({
    expoConfig: {} as Record<string, unknown>,
    application: {} as Record<string, unknown>,
    updates: {} as Record<string, unknown>,
}));

vi.mock('expo-constants', () => ({
    default: { get expoConfig() { return expo.expoConfig; } },
}));
vi.mock('expo-application', () => ({
    get nativeApplicationVersion() { return expo.application.nativeApplicationVersion; },
    get nativeBuildVersion() { return expo.application.nativeBuildVersion; },
    get applicationId() { return expo.application.applicationId; },
}));
vi.mock('expo-updates', () => ({
    get channel() { return expo.updates.channel; },
    get updateId() { return expo.updates.updateId; },
    get runtimeVersion() { return expo.updates.runtimeVersion; },
    get createdAt() { return expo.updates.createdAt; },
    get isEmbeddedLaunch() { return expo.updates.isEmbeddedLaunch; },
}));

describe('readCurrentAppRuntimeInfo', () => {
    it('reads native and OTA runtime details from Expo modules', () => {
        expo.expoConfig = { version: '0.2.1', updates: { requestHeaders: { 'expo-channel-name': 'production' } } };
        expo.application = { nativeApplicationVersion: '0.2.0', nativeBuildVersion: '101', applicationId: 'dev.happier.app' };
        expo.updates = {
            channel: 'production',
            updateId: 'update-123',
            runtimeVersion: '18',
            createdAt: new Date('2026-04-06T12:34:56.000Z'),
            isEmbeddedLaunch: false,
        };

        expect(readCurrentAppRuntimeInfo()).toEqual({
            appVersion: '0.2.1',
            nativeApplicationVersion: '0.2.0',
            nativeBuildVersion: '101',
            applicationId: 'dev.happier.app',
            updateChannel: 'production',
            updateId: 'update-123',
            runtimeVersion: '18',
            updateCreatedAt: '2026-04-06T12:34:56.000Z',
            launchSource: 'ota',
        });
    });

    it('falls back to the configured Expo channel and marks embedded launches', () => {
        expo.expoConfig = { version: '0.2.1', updates: { requestHeaders: { 'expo-channel-name': 'preview' } } };
        expo.application = { nativeApplicationVersion: null, nativeBuildVersion: null, applicationId: null };
        expo.updates = { channel: null, updateId: null, runtimeVersion: null, createdAt: null, isEmbeddedLaunch: true };

        expect(readCurrentAppRuntimeInfo()).toEqual({
            appVersion: '0.2.1',
            nativeApplicationVersion: null,
            nativeBuildVersion: null,
            applicationId: null,
            updateChannel: 'preview',
            updateId: null,
            runtimeVersion: null,
            updateCreatedAt: null,
            launchSource: 'embedded',
        });
    });

    it('uses the native application version when Expo reports the placeholder app version', () => {
        expo.expoConfig = { version: '0.0.0', updates: { requestHeaders: { 'expo-channel-name': 'development' } } };
        expo.application = { nativeApplicationVersion: '0.2.10', nativeBuildVersion: '101', applicationId: 'dev.happier.app' };
        expo.updates = { channel: 'development', updateId: null, runtimeVersion: '0.2.1-native', createdAt: null, isEmbeddedLaunch: true };

        expect(readCurrentAppRuntimeInfo()).toMatchObject({
            appVersion: '0.2.10',
            nativeApplicationVersion: '0.2.10',
            updateChannel: 'development',
            runtimeVersion: '0.2.1-native',
        });
    });
});
