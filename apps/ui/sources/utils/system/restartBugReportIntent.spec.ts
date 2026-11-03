import { describe, expect, it, vi } from 'vitest';

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

import { consumeRestartBugReportIntent, persistRestartBugReportIntent } from './restartBugReportIntent';

describe('restartBugReportIntent native behavior', () => {
    it('persists and consumes a native restart intent through Expo File', async () => {
        const createdAtMs = Date.now() - 5_000;

        await persistRestartBugReportIntent({
            v: 1,
            createdAtMs,
            reason: 'crash',
        });
        expect(expoFs.files?.size).toBe(1);

        await expect(consumeRestartBugReportIntent()).resolves.toBe(true);
        await expect(consumeRestartBugReportIntent()).resolves.toBe(false);

        expect(expoFs.files?.size).toBe(0);
    });
});
