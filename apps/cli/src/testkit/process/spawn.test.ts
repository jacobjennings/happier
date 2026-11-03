import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import * as processHelpers from './spawn';

describe('process spawn helpers', () => {
  it('waits for a complete newline-delimited PID across stdout chunks', async () => {
    const child = processHelpers.spawnInlineNodeTestProcess(`
      process.stdout.write('12');
      process.stdin.once('data', () => process.stdout.write('345\\n'));
      setTimeout(() => process.exit(0), 2000);
    `, { stdio: ['pipe', 'pipe', 'ignore'] });
    let resolved = false;
    const pid = processHelpers.readTestProcessPid(child).then(value => { resolved = true; return value; });
    try {
      await once(child.stdout!, 'data');
      expect(resolved).toBe(false);
      child.stdin!.end('finish line');
      await expect(pid).resolves.toBe(12345);
    } finally {
      child.kill();
      await processHelpers.waitForProcessExit(child.pid!);
    }
  });

  it('rejects malformed, process-group and unsafe PID lines', async () => {
    for (const line of ['0', '1', '', 'NaN', '123oops', '9007199254740992']) {
      const child = processHelpers.spawnInlineNodeTestProcess(`process.stdout.write(${JSON.stringify(line + '\n')});`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      try {
        await expect(processHelpers.readTestProcessPid(child)).rejects.toThrow('invalid child pid');
      } finally {
        child.kill();
        await processHelpers.waitForProcessExit(child.pid!);
      }
    }
  });

  it('spawns a child process and exposes its pid', async () => {
    const child = processHelpers.spawnTestProcess(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });

    expect(child.pid).toBeTypeOf('number');

    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        expect(code).toBe(0);
        resolve();
      });
    });
  });

  it('tracks pid liveness and waits for exit', async () => {
    const child = processHelpers.spawnTestProcess(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 50)']);
    const pid = child.pid;

    expect(pid).toBeTypeOf('number');
    expect(processHelpers.isPidAlive(pid!)).toBe(true);
    await expect(processHelpers.waitForProcessExit(pid!, { timeoutMs: 2_000 })).resolves.toBe(true);
    expect(processHelpers.isPidAlive(pid!)).toBe(false);
  });

  it('spawns detached inline node processes', async () => {
    const child = processHelpers.spawnDetachedInlineNodeTestProcess('setInterval(() => {}, 1000)');
    const pid = child.pid;

    expect(pid).toBeTypeOf('number');
    expect(processHelpers.isPidAlive(pid!)).toBe(true);

    try {
      process.kill(pid!, 'SIGTERM');
    } catch {
      // ignore
    }

    await expect(processHelpers.waitForProcessExit(pid!, { timeoutMs: 2_000 })).resolves.toBe(true);
  });

  it('spawns a parent node process that reports a child pid', async () => {
    const { parent, childPid } = await processHelpers.spawnInlineNodeParentWithChild();

    expect(parent.pid).toBeTypeOf('number');
    expect(childPid).toBeGreaterThan(0);
    expect(processHelpers.isPidAlive(parent.pid!)).toBe(true);
    expect(processHelpers.isPidAlive(childPid)).toBe(true);

    try {
      process.kill(childPid, 'SIGTERM');
      await expect(processHelpers.waitForProcessExit(childPid, { timeoutMs: 2_000 })).resolves.toBe(true);
    } finally {
      parent.kill();
      await expect(processHelpers.waitForProcessExit(parent.pid!, { timeoutMs: 2_000 })).resolves.toBe(true);
    }
  });
});
