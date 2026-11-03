import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const wrapperSource = join(dirname(fileURLToPath(import.meta.url)), '..', 'env-wrapper.cjs');
const childProcessOptionsSource = join(dirname(wrapperSource), 'childProcessOptions.cjs');

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

/**
 * `env-wrapper.cjs` is published (`apps/cli` ships `scripts/**\/*.cjs`) and forwards
 * arbitrary user CLI arguments to the real bin. Its Windows branch is unreachable on
 * macOS, so these tests force `process.platform` in a preload: `node:path` is already
 * bootstrapped POSIX by then, so only the wrapper's own platform decision changes.
 */
async function createWrapperTree(): Promise<{
  root: string;
  wrapperPath: string;
  binPath: string;
  homeDir: string;
  reportPath: string;
}> {
  // A space in the install path is the exact input a concatenating shell command line
  // splits apart (Node DEP0190) — a default Windows install lives in `C:\Program Files`.
  const created = await mkdtemp(join(tmpdir(), 'happier env wrapper '));
  roots.push(created);
  // The wrapper derives its bin path from `__dirname`, which Node reports realpath-resolved
  // (macOS `/var` is a symlink to `/private/var`).
  const root = await realpath(created);
  const wrapperPath = join(root, 'scripts', 'env-wrapper.cjs');
  const binPath = join(root, 'bin', 'happier.mjs');
  const homeDir = join(root, 'home');
  const reportPath = join(root, 'delivered-argv.json');
  await mkdir(dirname(wrapperPath), { recursive: true });
  await mkdir(dirname(binPath), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeFile(wrapperPath, await readFile(wrapperSource, 'utf8'), 'utf8');
  await writeFile(
    join(dirname(wrapperPath), 'childProcessOptions.cjs'),
    await readFile(childProcessOptionsSource, 'utf8'),
    'utf8',
  );
  await writeFile(
    binPath,
    [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ argv: process.argv.slice(2), execPath: process.execPath }), 'utf8');`,
      '',
    ].join('\n'),
    'utf8',
  );
  return { root, wrapperPath, binPath, homeDir, reportPath };
}

async function writeWin32Preload(root: string): Promise<string> {
  const preloadPath = join(root, 'force-win32.cjs');
  await writeFile(
    preloadPath,
    `Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });\n`,
    'utf8',
  );
  return preloadPath;
}

describe('apps/cli/scripts/env-wrapper.cjs', () => {
  it('delivers user arguments to the CLI byte-for-byte from an install path containing spaces', async () => {
    const tree = await createWrapperTree();
    const preloadPath = await writeWin32Preload(tree.root);
    const userArgs = ['arg with spaces', 'quote"inside', '$(exit 3)', 'semi;colon&amp'];

    // PATH holds no Node (an unset PATH would fall back to the system default search
    // path), so only re-entering the absolute running Node delivers the arguments.
    const envWithoutNodeOnPath = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
    );
    spawnSync(
      process.execPath,
      ['--require', preloadPath, tree.wrapperPath, 'dev', 'auth', ...userArgs],
      { env: { ...envWithoutNodeOnPath, PATH: tree.homeDir, HOME: tree.homeDir }, encoding: 'utf8' },
    );

    const delivered = JSON.parse(await readFile(tree.reportPath, 'utf8')) as { argv: string[]; execPath: string };
    // A shell (Node DEP0190) would concatenate argv into one unescaped command line,
    // splitting the spaced install path and handing user arguments to a shell parser.
    expect(delivered.argv).toEqual(['auth', ...userArgs]);
    // The wrapper re-enters the Node runtime already running it, not a bare PATH lookup.
    expect(delivered.execPath).toBe(process.execPath);
  }, 30_000);

  it.skipIf(process.platform === 'win32')('exits unsuccessfully when the CLI is terminated by a signal', async () => {
    const tree = await createWrapperTree();
    await writeFile(tree.binPath, "process.kill(process.pid, 'SIGTERM');\n", 'utf8');

    const result = spawnSync(
      process.execPath,
      [tree.wrapperPath, 'dev', 'auth'],
      { env: { ...process.env, HOME: tree.homeDir }, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
  });
});
