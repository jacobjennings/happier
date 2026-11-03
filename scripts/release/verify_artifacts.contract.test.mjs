import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

import { resolveTarCreateArgs } from '../pipeline/release/lib/archive-tar-options.mjs';
import {
  createBaseCliRuntimeSmokeFixtureFiles,
  createMinisignTestSigner,
  createWindowsBaseCliRuntimeSmokeFixtureFiles,
} from '../testing/releaseArtifactFixtures.mjs';
import { terminateProcessTreeByPid } from '../testing/process/processTree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const verifyArtifactsPath = resolve(repoRoot, 'scripts', 'pipeline', 'release', 'verify-artifacts.mjs');
const nodeArchivePath = resolve(repoRoot, 'scripts', 'pipeline', 'release', 'node-archive.mjs');

// Manual archive fixtures model the producer's 0755/0644 modes even on shared
// remote builders whose login umask permits group writes.
const fixtureUmask = process.umask(0o022);
after(() => process.umask(fixtureUmask));

function normalizeArchivePlatform(platform) {
  return platform === 'win32' ? 'windows' : platform;
}

function normalizeArchiveArch(arch) {
  if (arch === 'x86_64' || arch === 'amd64') return 'x64';
  if (arch === 'aarch64') return 'arm64';
  return arch;
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}


async function createComponentFixture({
  product = 'happier-difftastic',
  foreign = false,
  files,
  signedComponent = true,
  targetOs,
  targetArch,
} = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-component-'));
  const artifactsDir = join(workspace, 'artifacts');
  const os = targetOs ?? (foreign ? (process.platform === 'linux' ? 'windows' : 'linux') : normalizeArchivePlatform(process.platform));
  const arch = targetArch ?? (foreign ? 'x64' : normalizeArchiveArch(process.arch));
  const archiveStem = `${product}-v1.2.3-${os}-${arch}`;
  const archiveName = `${archiveStem}.tar.gz`;
  const stageRoot = join(workspace, 'stage');
  await mkdir(artifactsDir);
  await mkdir(join(stageRoot, archiveStem), { recursive: true });
  for (const [name, content] of Object.entries(files ?? { [os === 'windows' ? 'difft.exe' : 'difft']: foreign ? 'foreign native executable' : '#!/usr/bin/env node\nconsole.log("difftastic 0.64.0");\n' })) {
    const path = join(stageRoot, archiveStem, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { mode: 0o755 });
  }
  await tar.c({ gzip: true, portable: true, cwd: stageRoot, file: join(artifactsDir, archiveName) }, [archiveStem]);
  const signer = createMinisignTestSigner();
  const publicKeyPath = join(workspace, 'public.key');
  await writeFile(publicKeyPath, signer.publicKeyFile);
  const seal = async (path, text) => {
    await writeFile(path, text);
    await writeFile(`${path}.minisig`, signer.sign(text));
  };
  const componentChecksumsPath = join(artifactsDir, `checksums-${product}-v1.2.3.txt`);
  const componentChecksumsText = `${await sha256(join(artifactsDir, archiveName))}  ${archiveName}\n`;
  if (signedComponent) await seal(componentChecksumsPath, componentChecksumsText);
  else await writeFile(componentChecksumsPath, componentChecksumsText);
  const checksumsPath = join(artifactsDir, 'checksums-release-v1.2.3.txt');
  const resealPrimary = async () => {
    const names = [archiveName, basename(componentChecksumsPath)];
    if (signedComponent) names.push(`${basename(componentChecksumsPath)}.minisig`);
    await writeFile(checksumsPath, (await Promise.all(names.map(async (name) => `${await sha256(join(artifactsDir, name))}  ${name}\n`))).join(''));
  };
  await resealPrimary();
  const run = (args = [], env = process.env) => JSON.parse(execFileSync(process.execPath, [verifyArtifactsPath, '--artifacts-dir', artifactsDir, '--checksums', checksumsPath, '--public-key', publicKeyPath, ...args], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', env }));
  return { workspace, artifactsDir, archiveName, stageRoot, archiveStem, componentChecksumsPath, checksumsPath, resealPrimary, seal, run };
}

test('verify-artifacts accepts signed component envelopes and foreign layouts without executing foreign binaries', async () => {
  const fixture = await createComponentFixture({ foreign: true });
  try {
    await fixture.seal(fixture.checksumsPath, await readFile(fixture.checksumsPath, 'utf8'));
    const result = fixture.run();
    assert.ok(result.verified.includes(fixture.archiveName));
    assert.deepEqual(result.verifiedComponentEnvelopes, [basename(fixture.componentChecksumsPath)]);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

for (const product of ['happier', 'happier-memory-runtime', 'happier-voice-runtime', 'happier-difftastic']) {
  test(`verify-artifacts applies canonical traversal validation to foreign ${product} archives even with --skip-smoke`, async () => {
    const fixture = await createComponentFixture({ product, foreign: true });
    try {
      await tar.c({ gzip: true, portable: true, prefix: '../escape', cwd: fixture.stageRoot, file: join(fixture.artifactsDir, fixture.archiveName) }, [fixture.archiveStem]);
      await fixture.seal(fixture.componentChecksumsPath, `${await sha256(join(fixture.artifactsDir, fixture.archiveName))}  ${fixture.archiveName}\n`);
      await fixture.resealPrimary();
      assert.throws(() => fixture.run(['--skip-smoke']), /archive topology admission|archive entry.*non-portable path/i);
    } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
  });
}

test('verify-artifacts verifies component signatures even when the primary envelope is valid and smoke is skipped', async () => {
  const fixture = await createComponentFixture({ foreign: true });
  try {
    await writeFile(`${fixture.componentChecksumsPath}.minisig`, 'invalid component signature');
    await fixture.resealPrimary();
    await fixture.seal(fixture.checksumsPath, await readFile(fixture.checksumsPath, 'utf8'));
    assert.throws(() => fixture.run(['--require-signature', '--skip-smoke']), /signature verification failed/i);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test('verify-artifacts reaches native optional smoke for an unsigned local-build envelope', async () => {
  const marker = join(tmpdir(), `happier-unsigned-component-smoke-${process.pid}-${Date.now()}`);
  const fixture = await createComponentFixture({
    signedComponent: false,
    files: {
      difft: '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.HAPPIER_TEST_UNSIGNED_SMOKE_MARKER, "reached\\n"); console.log("difftastic 0.64.0");\n',
    },
  });
  try {
    const result = fixture.run([], { ...process.env, HAPPIER_TEST_UNSIGNED_SMOKE_MARKER: marker });
    assert.ok(result.verified.includes(fixture.archiveName));
    assert.equal(await readFile(marker, 'utf8'), 'reached\n');
  } finally {
    await rm(marker, { force: true });
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts checks the component checksum against its archive independently of the primary envelope', async () => {
  const fixture = await createComponentFixture({ foreign: true });
  try {
    await fixture.seal(fixture.componentChecksumsPath, `${'0'.repeat(64)}  ${fixture.archiveName}\n`);
    await fixture.resealPrimary();
    assert.throws(() => fixture.run(['--skip-smoke']), /checksum mismatch/i);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test('verify-artifacts validates foreign component layouts without executing them', async () => {
  const fixture = await createComponentFixture({ foreign: true, files: { 'LICENSE.txt': 'license' } });
  try {
    assert.throws(() => fixture.run(['--skip-smoke']), /missing.*entrypoint|ENOENT/i);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test('verify-artifacts runs the native difftastic component', async () => {
  const fixture = await createComponentFixture({ files: { difft: '#!/usr/bin/env node\nconsole.error("difft smoke reached"); process.exit(7);\n' } });
  try {
    assert.throws(() => fixture.run(), /difft smoke reached/);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test('verify-artifacts rejects a timed-out difftastic version smoke even when it prints version output', async () => {
  const fixture = await createComponentFixture({
    files: {
      difft: [
        '#!/usr/bin/env bash',
        "printf 'difftastic version 0.64.0\\n'",
        'while true; do sleep 1; done',
        '',
      ].join('\n'),
    },
  });
  try {
    assert.throws(
      () => fixture.run([], { ...process.env, HAPPIER_RELEASE_BINARY_SMOKE_TIMEOUT_MS: '500' }),
      /smoke test timed out/i,
    );
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test('verify-artifacts imports the native memory runtime instead of accepting an unopened module', async () => {
  const fixture = await createComponentFixture({ product: 'happier-memory-runtime', files: { 'node_modules/@huggingface/transformers/dist/transformers.node.mjs': 'throw new Error("memory smoke reached");' } });
  try {
    assert.throws(() => fixture.run(), /memory smoke reached/);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test('verify-artifacts exercises the Transformers ONNX tensor boundary with remote models disabled', async () => {
  // Third-party module fixture distinguishes import-only smoke from the ONNX value boundary.
  const fixture = await createComponentFixture({ product: 'happier-memory-runtime', files: {
    'node_modules/@huggingface/transformers/dist/transformers.node.mjs': `
      export const env = { allowRemoteModels: true };
      export class Tensor {
        constructor() {
          if (env.allowRemoteModels) throw new Error('remote models must be disabled');
          throw new Error('ONNX tensor boundary reached');
        }
      }
    `,
  } });
  try {
    assert.throws(() => fixture.run(), /ONNX tensor boundary reached/);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test('verify-artifacts imports the native voice runtime and requires a Sherpa inference constructor', async () => {
  const fixture = await createComponentFixture({ product: 'happier-voice-runtime', files: {
    'node_modules/sherpa-onnx-node/sherpa-onnx.js': 'module.exports = { OnlineRecognizer: class OnlineRecognizer {} };',
  } });
  try {
    assert.doesNotThrow(() => fixture.run());
    await writeFile(
      join(fixture.stageRoot, fixture.archiveStem, 'node_modules/sherpa-onnx-node/sherpa-onnx.js'),
      'module.exports = {};',
    );
    await tar.c({ gzip: true, portable: true, cwd: fixture.stageRoot, file: join(fixture.artifactsDir, fixture.archiveName) }, [fixture.archiveStem]);
    await fixture.seal(fixture.componentChecksumsPath, `${await sha256(join(fixture.artifactsDir, fixture.archiveName))}  ${fixture.archiveName}\n`);
    await fixture.resealPrimary();
    assert.throws(() => fixture.run(), /Invalid Sherpa native runtime exports/);
  } finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});


test('verify-artifacts requires explicit checksums when component envelopes coexist', async () => {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'happier-verify-envelopes-'));
  const primaryPath = join(artifactsDir, 'checksums-happier-v1.2.3.txt');
  const run = (args = []) => execFileSync(process.execPath, [
    verifyArtifactsPath, '--artifacts-dir', artifactsDir, '--skip-smoke', ...args,
  ], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
  try {
    const metadataPath = join(artifactsDir, 'metadata.json');
    await writeFile(metadataPath, '{}');
    const checksums = `${await sha256(metadataPath)}  metadata.json\n`;
    await writeFile(primaryPath, checksums);
    assert.equal(JSON.parse(run()).checksumsPath, primaryPath);
    await writeFile(join(artifactsDir, 'checksums-happier-difftastic-v1.2.3.txt'), checksums);
    assert.throws(() => run(), /multiple checksums.*--checksums/i);
    assert.equal(JSON.parse(run(['--checksums', primaryPath])).checksumsPath, primaryPath);
  } finally {
    await rm(artifactsDir, { recursive: true, force: true });
  }
});

function createDeterministicIncompressiblePadding(byteLength) {
  // Keep scan-boundary fixtures below the independent archive expansion limit.
  const bytes = Buffer.alloc(byteLength);
  let state = 0x9e3779b9;
  for (let index = 0; index < byteLength; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

function createCanonicalTarArchive({ archivePath, sourcePath, sourceName }) {
  createTarArchiveWithNumericOwner({
    archivePath,
    sourcePath,
    sourceName,
    uid: 0,
    gid: 0,
  });
}

function createTarArchiveWithNumericOwner({ archivePath, sourcePath, sourceName, uid, gid }) {
  const version = spawnSync('tar', ['--version'], { encoding: 'utf-8' });
  const isGnuTar = String(version.stdout ?? '').includes('GNU tar');
  const args = uid === 0 && gid === 0
    ? resolveTarCreateArgs({
        isGnuTar,
        excludeArgs: [],
        artifactArg: archivePath,
        sourceDirArg: sourcePath,
        sourceNameArg: sourceName,
        compressed: true,
      })
    : isGnuTar
      ? [
          '--sort=name',
          '--mtime=@0',
          `--owner=${uid}`,
          `--group=${gid}`,
          '--numeric-owner',
          '-czf',
          archivePath,
          '-C',
          sourcePath,
          sourceName,
        ]
      : [
          '--no-mac-metadata',
          '--uid',
          String(uid),
          '--gid',
          String(gid),
          '--numeric-owner',
          '-czf',
          archivePath,
          '-C',
          sourcePath,
          sourceName,
        ];
  execFileSync('tar', args, { cwd: repoRoot, stdio: 'pipe', timeout: 10_000 });
}

async function createReleaseArchiveFixture({
  workspace,
  archiveStem = 'happier-v0.0.0-admission-linux-x64',
  archiveRoot = archiveStem,
  files,
}) {
  const artifactsDir = join(workspace, 'artifacts');
  const stageRoot = join(workspace, 'stage');
  const archiveStageDir = join(stageRoot, archiveRoot);
  const archiveName = `${archiveStem}.tar.gz`;
  const archivePath = join(artifactsDir, archiveName);
  const checksumsPath = join(artifactsDir, 'checksums-happier-v0.0.0-admission.txt');

  await mkdir(archiveStageDir, { recursive: true, mode: 0o755 });
  await chmod(archiveStageDir, 0o755);
  await mkdir(artifactsDir, { recursive: true });
  for (const file of files) {
    const filePath = join(archiveStageDir, file.path);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o755 });
    await writeFile(filePath, file.contents, { mode: file.mode ?? 0o644 });
    await chmod(filePath, file.mode ?? 0o644);
  }

  execFileSync(
    process.execPath,
    [
      nodeArchivePath,
      '--artifact-path',
      archivePath,
      '--source-path',
      stageRoot,
      '--source-name',
      archiveRoot,
    ],
    { cwd: repoRoot, stdio: 'pipe', timeout: 10_000 },
  );
  await writeFile(checksumsPath, `${await sha256(archivePath)}  ${archiveName}\n`, 'utf-8');
  return { archiveName, archivePath, archiveRoot, stageRoot, artifactsDir, checksumsPath };
}

function verifyArchiveFixture({
  artifactsDir,
  checksumsPath,
  env = process.env,
  extraArgs = [],
}) {
  return spawnSync(
    process.execPath,
    [
      verifyArtifactsPath,
      '--artifacts-dir',
      artifactsDir,
      '--checksums',
      checksumsPath,
      '--skip-smoke',
      ...extraArgs,
    ],
    {
      cwd: repoRoot,
      env,
      encoding: 'utf-8',
      timeout: 10_000,
    },
  );
}

test('verify-artifacts rejects optional component payloads without their signed envelopes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-optional-'));
  try {
    for (const product of ['happier-memory-runtime', 'happier-voice-runtime', 'happier-difftastic']) {
      const fixture = await createReleaseArchiveFixture({
        workspace: join(workspace, product),
        archiveStem: `${product}-v0.0.0-admission-linux-x64`,
        files: [{ path: 'component', contents: 'runtime component\n', mode: 0o755 }],
      });
      const result = verifyArchiveFixture(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /missing checksums-.* asset/);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('opaque APK verification does not require binary-runtime build products', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-apk-'));
  const artifactsDir = join(workspace, 'artifacts');
  await mkdir(artifactsDir);
  const loader = join(workspace, 'unavailable-binary-runtime.mjs');
  // Model the package-resolution boundary without deleting shared build products.
  await writeFile(loader, `export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@happier-dev/cli-common')) {
      throw Object.assign(new Error('Binary runtime package is not built in the opaque publisher'), { code: 'ERR_MODULE_NOT_FOUND' });
    }
    return nextResolve(specifier, context);
  }\n`);
  const apkPath = join(artifactsDir, 'happier-stable-android.apk');
  const checksumsPath = join(artifactsDir, 'checksums-ui-mobile.txt');
  const run = () => JSON.parse(execFileSync(process.execPath, [
    '--experimental-loader', loader, verifyArtifactsPath,
    '--artifacts-dir', artifactsDir, '--checksums', checksumsPath,
  ], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }));
  try {
    await writeFile(apkPath, 'opaque APK fixture');
    await writeFile(checksumsPath, `${await sha256(apkPath)}  ${basename(apkPath)}\n`);
    assert.deepEqual(run().verified, [basename(apkPath)]);
    await writeFile(apkPath, 'tampered APK');
    assert.throws(run, /checksum mismatch/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts can require a signed checksum manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-require-signature-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const artifactName = 'artifact.bin';
    const artifactPath = join(artifactsDir, artifactName);
    const checksumsPath = join(artifactsDir, 'checksums-happier-v0.0.0-test.txt');

    await mkdir(artifactsDir, { recursive: true });
    await writeFile(artifactPath, 'artifact\n', 'utf-8');
    await writeFile(checksumsPath, `${await sha256(artifactPath)}  ${artifactName}\n`, 'utf-8');

    const result = spawnSync(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        artifactsDir,
        '--checksums',
        checksumsPath,
        '--require-signature',
        '--skip-smoke',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 5_000,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /required checksum signature is missing/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts can require every archive to appear in the signed checksum manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-complete-archives-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [{ path: 'happier', contents: 'binary\n', mode: 0o755 }],
    });
    await writeFile(
      join(fixture.artifactsDir, 'happier-v0.0.0-admission-linux-arm64.tar.gz'),
      'unchecksummed archive\n',
      'utf-8',
    );

    const result = verifyArchiveFixture({
      artifactsDir: fixture.artifactsDir,
      checksumsPath: fixture.checksumsPath,
      extraArgs: ['--require-all-archives-checksummed'],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /archive set does not match the checksum manifest/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts can require every candidate payload file to appear in the signed checksum manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-complete-envelope-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [{ path: 'happier', contents: 'binary\n', mode: 0o755 }],
    });
    await writeFile(
      join(fixture.artifactsDir, 'darwin-x64.cli.json'),
      '{"tampered":true}\n',
      'utf-8',
    );

    const result = verifyArchiveFixture({
      artifactsDir: fixture.artifactsDir,
      checksumsPath: fixture.checksumsPath,
      extraArgs: ['--require-all-artifacts-checksummed'],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /artifact set does not match the checksum manifest/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects notarization evidence changed after its checksum was signed', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-tampered-evidence-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const evidenceName = 'darwin-arm64.cli.json';
    const evidencePath = join(artifactsDir, evidenceName);
    const checksumsPath = join(artifactsDir, 'checksums-happier-v0.0.0-test.txt');
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(evidencePath, '{"status":"accepted"}\n', 'utf-8');
    await writeFile(checksumsPath, `${await sha256(evidencePath)}  ${evidenceName}\n`, 'utf-8');
    await writeFile(evidencePath, '{"status":"tampered"}\n', 'utf-8');

    const result = spawnSync(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        artifactsDir,
        '--checksums',
        checksumsPath,
        '--require-all-artifacts-checksummed',
        '--skip-archive-admission',
        '--skip-smoke',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 5_000,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch for darwin-arm64\.cli\.json/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function rewriteFixtureChecksum(fixture) {
  await writeFile(
    fixture.checksumsPath,
    `${await sha256(fixture.archivePath)}  ${fixture.archiveName}\n`,
    'utf-8',
  );
}

async function rewriteFixtureWithoutExplicitNestedDirectory(fixture) {
  await tar.c(
    {
      cwd: fixture.stageRoot,
      file: fixture.archivePath,
      gzip: true,
      mtime: new Date(0),
      noDirRecurse: true,
      portable: true,
    },
    [
      fixture.archiveRoot,
      `${fixture.archiveRoot}/nested/tool`,
    ],
  );
  await rewriteFixtureChecksum(fixture);
}

function withoutExecutableSearchPath(env = process.env) {
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([name]) => name.toLowerCase() !== 'path'),
    ),
    PATH: '',
  };
}

async function runCommandWithWallTimeout(command, args, { cwd, env, timeoutMs }) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;
  let timer;

  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });

  await new Promise((resolvePromise, rejectPromise) => {
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise();
      }
    };

    child.once('error', (error) => {
      settle(error);
    });
    child.once('close', (code, signal) => {
      if (timedOut) return;
      if ((code ?? 1) !== 0) {
        settle(
          new Error(
            `Command failed with status ${code ?? 1}${signal ? ` (${signal})` : ''}: ${[stdout, stderr]
              .map((value) => value.trim())
              .filter(Boolean)
              .join('\n')}`,
          ),
        );
        return;
      }
      settle();
    });

    timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTreeByPid(child.pid ?? 0, {
        graceMs: 250,
        pollMs: 25,
        skipAliveCheck: true,
      }).finally(() => {
        settle(new Error(`Command timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);
  });
}

test('verify-artifacts discovers its checksum file without a POSIX shell', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-checksum-discovery-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const artifactName = 'artifact.bin';
    const artifactPath = join(artifactsDir, artifactName);
    const checksumsPath = join(artifactsDir, 'checksums-happier-v0.0.0-test.txt');

    await mkdir(artifactsDir, { recursive: true });
    await writeFile(artifactPath, 'artifact\n', 'utf-8');
    await writeFile(checksumsPath, `${await sha256(artifactPath)}  ${artifactName}\n`, 'utf-8');

    execFileSync(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        artifactsDir,
        '--skip-smoke',
      ],
      {
        cwd: repoRoot,
        env: withoutExecutableSearchPath(),
        stdio: 'pipe',
        timeout: 5_000,
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts detects a signature without relying on a POSIX shell', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-signature-discovery-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const artifactName = 'artifact.bin';
    const artifactPath = join(artifactsDir, artifactName);
    const checksumsPath = join(artifactsDir, 'checksums-happier-v0.0.0-test.txt');

    await mkdir(artifactsDir, { recursive: true });
    await writeFile(artifactPath, 'artifact\n', 'utf-8');
    await writeFile(checksumsPath, `${await sha256(artifactPath)}  ${artifactName}\n`, 'utf-8');
    await writeFile(`${checksumsPath}.minisig`, 'signature\n', 'utf-8');

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            verifyArtifactsPath,
            '--artifacts-dir',
            artifactsDir,
            '--checksums',
            checksumsPath,
            '--skip-smoke',
          ],
          {
            cwd: repoRoot,
            env: withoutExecutableSearchPath(),
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 5_000,
          },
        ),
      /signature found but no --public-key/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts smoke extraction uses the canonical in-process archive owner without system tar', {
  skip: process.platform === 'win32',
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-smoke-no-tar-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveStem: 'happier-v0.0.0-no-tar-windows-x64',
      files: [{
        path: 'happier.exe',
        contents: 'synthetic Windows binary is not executed on non-Windows hosts\n',
        mode: 0o755,
      }],
    });

    const result = spawnSync(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        fixture.artifactsDir,
        '--checksums',
        fixture.checksumsPath,
      ],
      {
        cwd: repoRoot,
        env: withoutExecutableSearchPath(),
        encoding: 'utf-8',
        timeout: 10_000,
      },
    );

    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects high-confidence credential bytes without echoing them', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-credential-admission-'));
  const syntheticCredential = `github_pat_${'A'.repeat(82)}`;
  try {
    const scanTempDir = join(workspace, 'scan-temp');
    await mkdir(scanTempDir, { recursive: true });
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [
        {
          path: 'happier',
          contents: Buffer.concat([
            createDeterministicIncompressiblePadding(65_530),
            Buffer.from(`\u0000${syntheticCredential}\u0000compiled-suffix`, 'utf-8'),
          ]),
          mode: 0o755,
        },
      ],
    });

    const result = verifyArchiveFixture({
      ...fixture,
      env: {
        ...process.env,
        TMPDIR: scanTempDir,
        TMP: scanTempDir,
        TEMP: scanTempDir,
      },
    });
    const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput, /archive privacy admission failed.*credential-token/i);
    assert.doesNotMatch(combinedOutput, new RegExp(syntheticCredential));
    assert.deepEqual(await readdir(scanTempDir), []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects absolute user/build paths embedded in release payloads', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-path-admission-'));
  const syntheticBuildPaths = [
    { value: '/Users/synthetic-release-builder/work/happier/dev/apps/cli/source.ts', rule: 'absolute-user-path' },
    { value: '/home/synthetic-release-builder/work/happier/dev/apps/cli/source.ts', rule: 'absolute-user-path' },
    { value: 'C:\\Users\\synthetic-release-builder\\work\\happier\\dev\\apps\\cli\\source.ts', rule: 'absolute-user-path' },
    { value: '/__w/happier/happier/apps/cli/source.ts', rule: 'absolute-build-path' },
    { value: 'D:\\a\\happier\\happier\\apps\\cli\\source.ts', rule: 'absolute-build-path' },
  ];
  try {
    for (const [index, syntheticBuildPath] of syntheticBuildPaths.entries()) {
      const fixture = await createReleaseArchiveFixture({
        workspace: join(workspace, String(index)),
        files: [
          {
            path: 'happier',
            contents: Buffer.from(`source-map\u0000${syntheticBuildPath.value}\u0000`, 'utf-8'),
            mode: 0o755,
          },
        ],
      });

      const result = verifyArchiveFixture(fixture);
      const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      assert.notEqual(result.status, 0);
      assert.match(
        combinedOutput,
        new RegExp(`archive privacy admission failed.*${syntheticBuildPath.rule}`, 'i'),
      );
      assert.equal(combinedOutput.includes(syntheticBuildPath.value), false);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects synthetic private-key envelopes without echoing matching bytes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-private-key-admission-'));
  const syntheticPrivateKey = [
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'U1lOVEhFVElDX1BSSVZBVEVfS0VZX1NFTlRJTkVM',
    '-----END ENCRYPTED PRIVATE KEY-----',
    '',
  ].join('\n');
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [{ path: 'happier', contents: syntheticPrivateKey, mode: 0o755 }],
    });

    const result = verifyArchiveFixture(fixture);
    const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput, /archive privacy admission failed.*private-key/i);
    assert.equal(combinedOutput.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----'), false);
    assert.equal(combinedOutput.includes('U1lOVEhFVElDX1BSSVZBVEVfS0VZX1NFTlRJTkVM'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts detects boundary-spanning UTF-16LE Windows build paths', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-utf16-path-admission-'));
  const syntheticBuildPath =
    'C:\\Users\\synthetic-release-builder\\work\\happier\\dev\\apps\\cli\\source.ts';
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [
        {
          path: 'happier',
          contents: Buffer.concat([
            createDeterministicIncompressiblePadding(65_529),
            Buffer.from(syntheticBuildPath, 'utf16le'),
          ]),
          mode: 0o755,
        },
      ],
    });

    const result = verifyArchiveFixture(fixture);
    const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput, /archive privacy admission failed.*absolute-user-path/i);
    assert.equal(combinedOutput.includes(syntheticBuildPath), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts allows binary data, public certificates, and license prose that are not credentials', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-privacy-false-positive-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveStem: 'happier-ui-web-v0.0.0-admission-web-any',
      files: [
        {
          path: 'assets.bin',
          contents: Buffer.concat([
            Buffer.from([0x00, 0xff, 0x10, 0x80]),
            Buffer.from('sk-short\u0000token\u0000private key\u0000', 'utf-8'),
          ]),
        },
        {
          path: 'LICENSE.txt',
          contents: 'Permission is granted to use public-key cryptography. Keep your private key and token secure.\n',
        },
        {
          path: 'public-certificate.pem',
          contents: [
            '-----BEGIN CERTIFICATE-----',
            'U1lOVEhFVElDX1BVQkxJQ19DRVJUSUZJQ0FURQ==',
            '-----END CERTIFICATE-----',
            '',
          ].join('\n'),
        },
      ],
    });

    const result = verifyArchiveFixture(fixture);
    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects a release archive whose payload root does not match its artifact name', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-root-admission-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveRoot: 'unexpected-root',
      files: [{ path: 'happier', contents: 'binary\n', mode: 0o755 }],
    });

    const result = verifyArchiveFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, /archive payload root.*artifact name/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects non-canonical archived owners', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-owner-admission-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [{ path: 'happier', contents: 'binary\n', mode: 0o755 }],
    });
    createTarArchiveWithNumericOwner({
      archivePath: fixture.archivePath,
      sourcePath: fixture.stageRoot,
      sourceName: fixture.archiveRoot,
      uid: 123,
      gid: 456,
    });
    await rewriteFixtureChecksum(fixture);

    const result = verifyArchiveFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, /non-canonical-owner/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects non-canonical archived file modes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-mode-admission-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [{ path: 'happier', contents: 'binary\n', mode: 0o600 }],
    });
    createCanonicalTarArchive({
      archivePath: fixture.archivePath,
      sourcePath: fixture.stageRoot,
      sourceName: fixture.archiveRoot,
    });
    await rewriteFixtureChecksum(fixture);

    const result = verifyArchiveFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, /non-canonical-mode/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts applies the non-executable mode contract to UI web archives', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-ui-mode-admission-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveStem: 'happier-ui-web-v0.0.0-admission-web-any',
      archiveRoot: 'happier-ui-web-v0.0.0-admission-web-any',
      files: [{ path: 'index.html', contents: '<!doctype html>\n', mode: 0o755 }],
    });
    createCanonicalTarArchive({
      archivePath: fixture.archivePath,
      sourcePath: fixture.stageRoot,
      sourceName: fixture.archiveRoot,
    });
    await rewriteFixtureChecksum(fixture);

    const result = verifyArchiveFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, /non-canonical-mode/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts admits canonical UI web archive roots and static-file modes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-ui-positive-admission-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveStem: 'happier-ui-web-v0.0.0-admission-web-any',
      archiveRoot: 'happier-ui-web-v0.0.0-admission-web-any',
      files: [
        { path: 'index.html', contents: '<!doctype html>\n', mode: 0o644 },
        { path: 'assets/app.js', contents: 'console.log("synthetic public bundle");\n', mode: 0o644 },
      ],
    });

    const result = verifyArchiveFixture(fixture);
    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects files whose parent directories have no explicit admitted archive entries', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-parent-admission-'));
  try {
    const fixture = await createReleaseArchiveFixture({
      workspace,
      files: [{ path: 'nested/tool', contents: 'binary\n', mode: 0o755 }],
    });
    await rewriteFixtureWithoutExplicitNestedDirectory(fixture);

    const result = verifyArchiveFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, /explicit parent directory/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts smoke-runs packaged server binaries with isolated startup env instead of --help', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-server-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const stageRoot = join(workspace, 'stage');
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const archiveStem = `happier-server-v0.0.0-test-${archivePlatform}-${archiveArch}`;
    const stageDir = join(stageRoot, archiveStem);
    const markerPath = join(workspace, 'server-smoke-marker.txt');
    const archivePath = join(artifactsDir, `${archiveStem}.tar.gz`);
    const checksumsPath = join(artifactsDir, 'checksums-happier-server-v0.0.0-test.txt');

    await mkdir(stageDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      join(stageDir, 'happier-server'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'if [[ "${1-}" == "--help" ]]; then',
        '  echo "server smoke should not use --help"',
        '  exit 1',
        'fi',
        '[[ "${PORT-}" == "0" ]] || { echo "expected PORT=0 but got ${PORT-}"; exit 1; }',
        '[[ "${METRICS_PORT-}" == "0" ]] || { echo "expected METRICS_PORT=0 but got ${METRICS_PORT-}"; exit 1; }',
        '[[ -n "${HAPPIER_SERVER_LIGHT_DATA_DIR-}" ]] || { echo "missing HAPPIER_SERVER_LIGHT_DATA_DIR"; exit 1; }',
        `printf 'PORT=%s\\nMETRICS_PORT=%s\\nDATA=%s\\n' "$PORT" "$METRICS_PORT" "$HAPPIER_SERVER_LIGHT_DATA_DIR" > "${markerPath}"`,
        'exec sleep 30',
        '',
      ].join('\n'),
      { encoding: 'utf-8', mode: 0o755 },
    );

    createCanonicalTarArchive({ archivePath, sourcePath: stageRoot, sourceName: archiveStem });
    await writeFile(
      checksumsPath,
      `${await sha256(archivePath)}  ${archiveStem}.tar.gz\n`,
      'utf-8',
    );

    execFileSync(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        artifactsDir,
        '--checksums',
        checksumsPath,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HAPPIER_SERVER_LIGHT_DATA_DIR: '',
          HAPPIER_RELEASE_SERVER_SMOKE_TIMEOUT_MS: '1000',
          PORT: '',
          METRICS_PORT: '',
        },
        stdio: 'pipe',
      },
    );

    const marker = await readFile(markerPath, 'utf-8');
    assert.match(marker, /^PORT=0$/m);
    assert.match(marker, /^METRICS_PORT=0$/m);
    assert.match(marker, /^DATA=.+$/m);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects a packaged server binary that exits before the smoke window', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-server-early-exit-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const stageRoot = join(workspace, 'stage');
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const archiveStem = `happier-server-v0.0.0-early-exit-${archivePlatform}-${archiveArch}`;
    const stageDir = join(stageRoot, archiveStem);
    const archivePath = join(artifactsDir, `${archiveStem}.tar.gz`);
    const checksumsPath = join(artifactsDir, 'checksums-happier-server-v0.0.0-early-exit.txt');

    await mkdir(stageDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      join(stageDir, 'happier-server'),
      '#!/usr/bin/env bash\nexit 0\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    createCanonicalTarArchive({ archivePath, sourcePath: stageRoot, sourceName: archiveStem });
    await writeFile(
      checksumsPath,
      `${await sha256(archivePath)}  ${archiveStem}.tar.gz\n`,
      'utf-8',
    );

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            verifyArtifactsPath,
            '--artifacts-dir',
            artifactsDir,
            '--checksums',
            checksumsPath,
          ],
          {
            cwd: repoRoot,
            env: {
              ...process.env,
              // The contract is an early clean exit, not a scheduler race.
              // Keep enough headroom for this file's parallel archive tests to
              // observe the child close event on a loaded CI worker.
              HAPPIER_RELEASE_SERVER_SMOKE_TIMEOUT_MS: '2000',
            },
            encoding: 'utf-8',
            stdio: 'pipe',
          },
        ),
      /server binary exited before the smoke window/i,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts selects the packaged binary instead of a sibling sidecar directory', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-server-layout-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const stageRoot = join(workspace, 'stage');
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const archiveStem = `happier-server-v0.0.0-layout-${archivePlatform}-${archiveArch}`;
    const stageDir = join(stageRoot, archiveStem);
    const markerPath = join(workspace, 'selected-binary.txt');
    const archivePath = join(artifactsDir, `${archiveStem}.tar.gz`);
    const checksumsPath = join(artifactsDir, 'checksums-happier-server-v0.0.0-layout.txt');

    await mkdir(join(stageDir, 'generated', 'sqlite-client'), { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(stageDir, 'generated', 'sqlite-client', 'placeholder.txt'), 'placeholder\n', 'utf-8');
    await writeFile(
      join(stageDir, 'happier-server'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `printf 'selected-binary\\n' > "${markerPath}"`,
        'exec sleep 30',
        '',
      ].join('\n'),
      { encoding: 'utf-8', mode: 0o755 },
    );

    createCanonicalTarArchive({ archivePath, sourcePath: stageRoot, sourceName: archiveStem });
    await writeFile(
      checksumsPath,
      `${await sha256(archivePath)}  ${archiveStem}.tar.gz\n`,
      'utf-8',
    );

    execFileSync(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        artifactsDir,
        '--checksums',
        checksumsPath,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HAPPIER_RELEASE_SERVER_SMOKE_TIMEOUT_MS: '1000',
        },
        stdio: 'pipe',
      },
    );

    assert.equal(await readFile(markerPath, 'utf-8'), 'selected-binary\n');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts includes stdout in smoke failures when stderr is empty', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-stdout-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const stageRoot = join(workspace, 'stage');
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const archiveStem = `happier-v0.0.0-test-${archivePlatform}-${archiveArch}`;
    const stageDir = join(stageRoot, archiveStem);
    const archivePath = join(artifactsDir, `${archiveStem}.tar.gz`);
    const checksumsPath = join(artifactsDir, 'checksums-happier-v0.0.0-test.txt');

    await mkdir(stageDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      join(stageDir, 'happier'),
      '#!/usr/bin/env bash\necho "stdout-only smoke failure"\nexit 1\n',
      { encoding: 'utf-8', mode: 0o755 },
    );

    createCanonicalTarArchive({ archivePath, sourcePath: stageRoot, sourceName: archiveStem });
    await writeFile(
      checksumsPath,
      `${await sha256(archivePath)}  ${archiveStem}.tar.gz\n`,
      'utf-8',
    );

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            verifyArtifactsPath,
            '--artifacts-dir',
            artifactsDir,
            '--checksums',
            checksumsPath,
          ],
          { cwd: repoRoot, encoding: 'utf-8', stdio: 'pipe' },
        ),
      /stdout-only smoke failure/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects a CLI version mismatch even when optional smoke is skipped', {
  skip: process.platform === 'win32',
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-cli-version-'));
  try {
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveStem: `happier-v1.2.3-${archivePlatform}-${archiveArch}`,
      files: [{
        path: 'happier',
        contents: "#!/bin/sh\nprintf '%s\\n' '1.2.3-preview.99'\n",
        mode: 0o755,
      }],
    });

    const result = verifyArchiveFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      /version mismatch.*expected 1\.2\.3.*got 1\.2\.3-preview\.99/i,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts accepts a CLI binary whose version matches its archive version', {
  skip: process.platform === 'win32',
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-cli-version-match-'));
  try {
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const version = '1.2.3-preview.99';
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveStem: `happier-v${version}-${archivePlatform}-${archiveArch}`,
      files: Object.entries(createBaseCliRuntimeSmokeFixtureFiles(version)).map(([path, contents]) => ({
        path,
        contents,
        mode: path === 'happier' || path.startsWith('tools/unpacked/') ? 0o755 : 0o644,
      })),
    });

    const result = verifyArchiveFixture({
      ...fixture,
      env: {
        ...process.env,
        HAPPIER_TEST_RUNTIME_SMOKE_MARKER: join(workspace, 'runtime-smoke-markers.txt'),
      },
    });
    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts exercises the isolated runtime payload of a native base CLI', async () => {
  const version = '1.2.3';
  const fixture = await createComponentFixture({
    product: 'happier',
    files: createBaseCliRuntimeSmokeFixtureFiles(version),
  });
  try {
    const markerPath = join(fixture.workspace, 'runtime-smoke-markers.txt');
    const result = fixture.run(['--skip-smoke'], {
      ...process.env,
      HAPPIER_TEST_RUNTIME_SMOKE_MARKER: markerPath,
      NODE_PATH: join(fixture.workspace, 'outside-node-modules'),
    });
    assert.deepEqual(result.baseCliRuntimeSmokes, [fixture.archiveName]);
    const markers = new Set((await readFile(markerPath, 'utf8')).trim().split('\n'));
    assert.deepEqual(markers, new Set([
      'package-dist-version',
      'mcp-cjs',
      'mcp-server',
      'mcp-ping',
      'mcp-list',
      'mcp-call',
      'sharp',
      'node-pty',
      'rg-version',
      'rg-search',
      'zellij-version',
      ...(process.platform === 'linux' ? ['homebridge'] : []),
    ]));
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('base CLI projection accepts the required Windows tool set without zellij', {
  skip: process.platform === 'win32',
}, async () => {
  const fixture = await createComponentFixture({
    product: 'happier',
    targetOs: 'windows',
    targetArch: 'x64',
    files: createWindowsBaseCliRuntimeSmokeFixtureFiles('1.2.3'),
  });
  try {
    const result = fixture.run(['--skip-smoke']);
    assert.ok(result.verified.includes(fixture.archiveName));
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('base CLI projection rejects zellij in a Windows archive', {
  skip: process.platform === 'win32',
}, async () => {
  const fixture = await createComponentFixture({
    product: 'happier',
    targetOs: 'windows',
    targetArch: 'x64',
    files: {
      ...createWindowsBaseCliRuntimeSmokeFixtureFiles('1.2.3'),
      'tools/unpacked/zellij.exe': '#!/usr/bin/env bash\nprintf "zellij 0.44.3\\n"\n',
    },
  });
  try {
    assert.throws(
      () => fixture.run(['--skip-smoke']),
      /zellij.*survived Windows base CLI projection/i,
    );
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects a native CLI whose version works but help fails', async () => {
  const fixture = await createComponentFixture({
    product: 'happier',
    files: {
      ...createBaseCliRuntimeSmokeFixtureFiles('1.2.3'),
      happier: `#!/usr/bin/env bash
if [[ "\${1:-}" == '--help' ]]; then
  printf 'native help metadata failure\\n' >&2
  exit 1
fi
printf '1.2.3\\n'
`,
    },
  });
  try {
    assert.throws(() => fixture.run(['--skip-smoke'], {
      ...process.env,
      HAPPIER_TEST_RUNTIME_SMOKE_MARKER: join(fixture.workspace, 'runtime-smoke-markers.txt'),
    }), /native help metadata failure/);
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects the unused Claude Agent SDK left in a base CLI projection', async () => {
  const fixture = await createComponentFixture({
    product: 'happier',
    files: {
      ...createBaseCliRuntimeSmokeFixtureFiles('1.2.3'),
      'node_modules/@anthropic-ai/claude-agent-sdk/package.json': '{}',
    },
  });
  try {
    assert.throws(
      () => fixture.run(['--skip-smoke'], {
        ...process.env,
        HAPPIER_TEST_RUNTIME_SMOKE_MARKER: join(fixture.workspace, 'runtime-smoke-markers.txt'),
      }),
      /unused Claude Agent SDK survived projection/i,
    );
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects Sherpa and the retired embedded voice archive left in a base CLI projection', async () => {
  const archivePlatform = normalizeArchivePlatform(process.platform);
  const archiveArch = normalizeArchiveArch(process.arch);
  const fixture = await createComponentFixture({
    product: 'happier',
    files: {
      ...createBaseCliRuntimeSmokeFixtureFiles('1.2.3'),
      'node_modules/sherpa-onnx-node/sherpa-onnx.js': 'module.exports = {};',
      [`tools/archives/voice-inference-runtime-${archivePlatform}-${archiveArch}.tar.gz`]: 'retired duplicate voice runtime',
    },
  });
  try {
    assert.throws(
      () => fixture.run(['--skip-smoke'], {
        ...process.env,
        HAPPIER_TEST_RUNTIME_SMOKE_MARKER: join(fixture.workspace, 'runtime-smoke-markers.txt'),
      }),
      /optional inference runtime survived base CLI projection/i,
    );
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects an unused ripgrep native addon left in a base CLI projection', async () => {
  const fixture = await createComponentFixture({
    product: 'happier',
    files: {
      ...createBaseCliRuntimeSmokeFixtureFiles('1.2.3'),
      'tools/unpacked/ripgrep.node': 'unused native addon',
    },
  });
  try {
    assert.throws(
      () => fixture.run(['--skip-smoke'], {
        ...process.env,
        HAPPIER_TEST_RUNTIME_SMOKE_MARKER: join(fixture.workspace, 'runtime-smoke-markers.txt'),
      }),
      /unused ripgrep native addon survived projection/i,
    );
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects Windows PTY inputs left in a native non-Windows base CLI projection', {
  skip: process.platform === 'win32',
}, async () => {
  const fixture = await createComponentFixture({
    product: 'happier',
    files: {
      ...createBaseCliRuntimeSmokeFixtureFiles('1.2.3'),
      'node_modules/node-pty/third_party/conpty/win10-x64/conpty.node': 'unused Windows PTY input',
    },
  });
  try {
    assert.throws(
      () => fixture.run(['--skip-smoke'], {
        ...process.env,
        HAPPIER_TEST_RUNTIME_SMOKE_MARKER: join(fixture.workspace, 'runtime-smoke-markers.txt'),
      }),
      /Windows-only PTY input survived non-Windows projection/i,
    );
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts rejects a CLI that times out before its version can be attested', {
  skip: process.platform === 'win32',
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-cli-version-timeout-'));
  try {
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const fixture = await createReleaseArchiveFixture({
      workspace,
      archiveStem: `happier-v1.2.3-${archivePlatform}-${archiveArch}`,
      files: [{
        path: 'happier',
        contents: [
          '#!/bin/sh',
          "printf 'version %s\\n' '1.2.3-preview.99'",
          'while true; do sleep 1; done',
          '',
        ].join('\n'),
        mode: 0o755,
      }],
    });

    const result = verifyArchiveFixture({
      ...fixture,
      env: {
        ...process.env,
        HAPPIER_RELEASE_BINARY_SMOKE_TIMEOUT_MS: '500',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, /smoke test timed out/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts hard-times-out packaged server binaries that ignore SIGTERM', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-timeout-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const stageRoot = join(workspace, 'stage');
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const archiveStem = `happier-server-v0.0.0-timeout-${archivePlatform}-${archiveArch}`;
    const stageDir = join(stageRoot, archiveStem);
    const archivePath = join(artifactsDir, `${archiveStem}.tar.gz`);
    const checksumsPath = join(artifactsDir, 'checksums-happier-server-v0.0.0-timeout.txt');

    await mkdir(stageDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      join(stageDir, 'happier-server'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        "trap '' TERM",
        "printf 'ready\\n'",
        'while true; do sleep 1; done',
        '',
      ].join('\n'),
      { encoding: 'utf-8', mode: 0o755 },
    );

    createCanonicalTarArchive({ archivePath, sourcePath: stageRoot, sourceName: archiveStem });
    await writeFile(
      checksumsPath,
      `${await sha256(archivePath)}  ${archiveStem}.tar.gz\n`,
      'utf-8',
    );

    const startedAt = Date.now();
    await runCommandWithWallTimeout(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        artifactsDir,
        '--checksums',
        checksumsPath,
      ],
      {
        cwd: repoRoot,
        timeoutMs: 30_000,
      },
    );
    assert.ok(
      Date.now() - startedAt < 28_000,
      'verify-artifacts should stop hung packaged server binaries on its internal smoke timeout',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verify-artifacts honors the packaged server smoke timeout override', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'happier-verify-artifacts-timeout-override-'));
  try {
    const artifactsDir = join(workspace, 'artifacts');
    const stageRoot = join(workspace, 'stage');
    const archivePlatform = normalizeArchivePlatform(process.platform);
    const archiveArch = normalizeArchiveArch(process.arch);
    const archiveStem = `happier-server-v0.0.0-timeout-override-${archivePlatform}-${archiveArch}`;
    const stageDir = join(stageRoot, archiveStem);
    const archivePath = join(artifactsDir, `${archiveStem}.tar.gz`);
    const checksumsPath = join(artifactsDir, 'checksums-happier-server-v0.0.0-timeout-override.txt');

    await mkdir(stageDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      join(stageDir, 'happier-server'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        "trap '' TERM",
        "printf 'ready\\n'",
        'while true; do sleep 1; done',
        '',
      ].join('\n'),
      { encoding: 'utf-8', mode: 0o755 },
    );

    createCanonicalTarArchive({ archivePath, sourcePath: stageRoot, sourceName: archiveStem });
    await writeFile(
      checksumsPath,
      `${await sha256(archivePath)}  ${archiveStem}.tar.gz\n`,
      'utf-8',
    );

    const startedAt = Date.now();
    await runCommandWithWallTimeout(
      process.execPath,
      [
        verifyArtifactsPath,
        '--artifacts-dir',
        artifactsDir,
        '--checksums',
        checksumsPath,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HAPPIER_RELEASE_SERVER_SMOKE_TIMEOUT_MS: '200',
        },
        timeoutMs: 5_000,
      },
    );
    assert.ok(
      Date.now() - startedAt < 4_000,
      'verify-artifacts should respect the shorter packaged server smoke timeout override',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
