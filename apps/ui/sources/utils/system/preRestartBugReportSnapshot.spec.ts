import { beforeEach, describe, expect, it, vi } from 'vitest';

const expoFs = vi.hoisted(() => ({ files: null as Map<string, number[]> | null }));

vi.mock('expo-file-system', async () => {
    const { createExpoFileSystemFileMock } = await import('@/dev/testkit/mocks/expoFileSystem');
    const mock = createExpoFileSystemFileMock('file:///cache');
    expoFs.files = mock.files;
    return mock.module;
});
vi.mock('expo-file-system/legacy', () => {
    throw new Error('expo-file-system/legacy should not be imported');
});
vi.mock('react-native', () => ({
    Platform: { OS: 'android' },
}));

import { peekPreRestartBugReportSnapshot, persistPreRestartBugReportSnapshot } from './preRestartBugReportSnapshot';

const SNAPSHOT_PATH = 'file:///cache/pre-restart-bug-report-snapshot.v1.json';

function nativeFiles(): Map<string, number[]> {
    if (!expoFs.files) throw new Error('expo-file-system mock was not loaded');
    return expoFs.files;
}

describe('preRestartBugReportSnapshot native behavior', () => {
    beforeEach(() => {
        nativeFiles().clear();
    });

    it('persists and reads a native pre-restart snapshot through Expo File', async () => {
        const createdAtMs = Date.now() - 5_000;

        await persistPreRestartBugReportSnapshot({
            v: 1,
            createdAtMs,
            reason: 'crash',
            platform: 'android',
            origin: null,
            isSecureContext: null,
            errorDetails: 'boom',
            appLogs: 'logs',
            userActions: [],
        });

        expect([...nativeFiles().keys()]).toEqual([SNAPSHOT_PATH]);
        await expect(peekPreRestartBugReportSnapshot()).resolves.toMatchObject({
            v: 1,
            createdAtMs,
            reason: 'crash',
            platform: 'android',
            errorDetails: 'boom',
            appLogs: 'logs',
        });
    });

    it('clears an invalid native snapshot payload', async () => {
        nativeFiles().set(SNAPSHOT_PATH, [...new TextEncoder().encode('{not-json')]);

        await expect(peekPreRestartBugReportSnapshot()).resolves.toBeNull();

        expect(nativeFiles().has(SNAPSHOT_PATH)).toBe(false);
    });
});
