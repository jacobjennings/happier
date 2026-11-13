import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AGY_ACP_SERVER_VERSION } from '@happier-dev/protocol';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createTestAuth } from '../../src/testkit/auth';
import { seedCliAuthForServer } from '../../src/testkit/cliAuth';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { runCliJson } from '../../src/testkit/uiE2e/cliJson';
import { waitFor } from '../../src/testkit/timing';

const run = createRunDirs({ runLabel: 'core' });

describe('core e2e: Antigravity ACP session path', () => {
  let server: StartedServer | null = null;
  let daemon: StartedDaemon | null = null;

  afterEach(async () => {
    await daemon?.stop();
    daemon = null;
    await server?.stop();
    server = null;
  });

  // This fixture substitutes the native Google process boundary with a POSIX
  // executable. The real CLI, daemon, catalog and ACP client remain in use.
  it.skipIf(process.platform === 'win32')('passes --path to both process cwd and session/new', async () => {
    const testDir = run.testDir(`agy-session-path-${randomUUID()}`);
    server = await startServerLight({ testDir, dbProvider: 'sqlite' });
    const auth = await createTestAuth(server.baseUrl);
    const cliHome = resolve(testDir, 'cli-home');
    const workspace = resolve(testDir, 'zzz-workspace with spaces');
    const managedRoot = join(cliHome, 'tools', 'agy-acp-server');
    const current = join(managedRoot, 'current');
    await mkdir(current, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const capturePath = join(testDir, 'agy-session-new.jsonl');
    const executable = join(current, 'agy_acp_server.par');
    const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') {
    result = { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] };
  } else if (request.method === 'session/new') {
    fs.appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ cwd: process.cwd(), request: request.params }) + '\\n');
    result = { sessionId: 'agy-path-fixture' };
  } else if (request.method === 'session/prompt') {
    result = { stopReason: 'end_turn' };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`;
    await writeFile(executable, source);
    await chmod(executable, 0o755);
    const metadata = await stat(executable);
    await writeFile(join(managedRoot, 'install-state.json'), JSON.stringify({
      installedVersion: AGY_ACP_SERVER_VERSION,
      executableSha256: createHash('sha256').update(source).digest('hex'),
      executableSize: metadata.size,
      executableMtimeMs: metadata.mtimeMs,
      lastInstallLogPath: null,
    }));
    const { serverId } = await seedCliAuthForServer({
      cliHome, serverUrl: server.baseUrl, token: auth.token,
      secret: Uint8Array.from(randomBytes(32)),
    });
    const env = {
      ...process.env,
      CI: '1', HAPPIER_VARIANT: 'dev', HAPPIER_HOME_DIR: cliHome,
      HAPPIER_SERVER_URL: server.baseUrl, HAPPIER_WEBAPP_URL: server.baseUrl,
      HAPPIER_ACTIVE_SERVER_ID: serverId,
      HAPPIER_DISABLE_CAFFEINATE: '1',
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    };
    daemon = await startTestDaemon({ testDir, happyHomeDir: cliHome, env });
    const created = await runCliJson({
      testDir, cliHomeDir: cliHome, serverUrl: server.baseUrl, webappUrl: server.baseUrl,
      env, label: 'agy.create',
      args: ['session', 'create', '--backend', 'agent:agy', '--path', workspace,
        '--auth', 'native', '--prompt', 'Report the current directory.', '--json'],
      timeoutMs: 120_000,
      launchOptions: { preferSourceEntrypoint: true, skipSharedDepsBuild: true },
    });
    expect(created.ok).toBe(true);
    await waitFor(async () => {
      const text = await readFile(capturePath, 'utf8').catch(() => '');
      return text.trim().length > 0;
    }, { timeoutMs: 60_000, context: 'agy ACP session/new' });
    const captures: unknown[] = (await readFile(capturePath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(captures).toEqual(expect.arrayContaining([
      expect.objectContaining({ cwd: workspace, request: expect.objectContaining({ cwd: workspace }) }),
    ]));
  }, 240_000);
});
