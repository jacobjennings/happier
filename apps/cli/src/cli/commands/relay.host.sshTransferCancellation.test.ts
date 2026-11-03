import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reloadConfiguration } from '../../configuration';
import { createEnvKeyScope } from '../../testkit/env/envScope';
import { createTempDir, removeTempDir } from '../../testkit/fs/tempDir';
import { captureConsoleLogAndMuteStdout } from '../../testkit/logger/captureOutput';
import { commandRegistry } from '../commandRegistry';

const transferOpenSshFile = vi.hoisted(() => vi.fn(async (_params: Readonly<{ signal?: AbortSignal }>) => undefined));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
  };
});

vi.mock('@happier-dev/cli-common/ssh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/ssh')>();
  return {
    ...actual,
    transferOpenSshFile,
  };
});

vi.mock('@happier-dev/cli-common/relayHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/relayHost')>();
  return {
    ...actual,
    createRelayHostEngine: (deps: Readonly<{
      copyLocalDirectoryToRemote(params: Readonly<{ localPath: string; remotePath: string }>): Promise<void>;
    }>) => ({
      readStatus: async () => ({
        installed: true,
        version: 'preview-test',
        service: { active: true, enabled: true },
        baseUrl: 'https://relay.example.test',
        healthy: true,
      }),
      installOrUpdate: async () => {
        await deps.copyLocalDirectoryToRemote({
          localPath: '/tmp/happier-relay-payload',
          remotePath: '/tmp/happier-relay-destination',
        });
        return { relayUrl: 'https://relay.example.test', mode: 'user' as const };
      },
      control: async () => undefined,
    }),
  };
});

describe('happier relay host SSH transfer cancellation', () => {
  let home = '';
  let envScope = createEnvKeyScope(['HAPPIER_HOME_DIR']);

  beforeEach(async () => {
    transferOpenSshFile.mockClear();
    envScope = createEnvKeyScope(['HAPPIER_HOME_DIR']);
    home = await createTempDir('happier-relay-ssh-transfer-');
    envScope.patch({ HAPPIER_HOME_DIR: home });
    reloadConfiguration();
  });

  afterEach(async () => {
    envScope.restore();
    reloadConfiguration();
    await removeTempDir(home);
  });

  it('uses the canonical asynchronous SCP owner and threads the command cancellation signal', async () => {
    const output = captureConsoleLogAndMuteStdout();
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const controller = new AbortController();
    try {
      await commandRegistry.relay({
        args: ['relay', 'host', 'install', '--ssh', 'dev@example.test', '--preserve-active-server', '--json'],
        rawArgv: ['node', 'happier', 'relay', 'host', 'install', '--ssh', 'dev@example.test', '--preserve-active-server', '--json'],
        terminalRuntime: null,
        signal: controller.signal,
      });

      expect(transferOpenSshFile).toHaveBeenCalledOnce();
      expect(transferOpenSshFile).toHaveBeenCalledWith(expect.objectContaining({
        direction: 'upload',
        recursive: true,
        signal: controller.signal,
      }));
    } finally {
      output.restore();
      process.exitCode = previousExitCode;
    }
  });
});
