import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  copyCliBinRuntimeFiles,
  createCliBinPreflightSandbox,
  runHappierBin,
  writeCliProjectFixture,
  writeNodeModuleStub,
  writeProtocolBundleStub,
} from './testkit/cliBinPreflightSandbox';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('happier bin preflight', () => {
  it('works when protocol deps are vendored under protocol/node_modules (not hoisted to the CLI root)', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const { rootDir: tempRoot, cleanup } = createCliBinPreflightSandbox('happier-bin-preflight-');

    try {
      const { binDir } = writeCliProjectFixture({
        projectRoot: tempRoot,
        entrypointDir: 'dist',
        entrypointContent: "console.log('ok');\n",
      });

      copyCliBinRuntimeFiles({ repoRoot, binDir });

      // Global-install / packed layout:
      // - protocol is present as a bundled workspace package
      // - protocol runtime deps are vendored under protocol/node_modules
      writeProtocolBundleStub({
        packageDir: resolve(tempRoot, 'node_modules', '@happier-dev', 'protocol'),
      });
      writeNodeModuleStub({
        packageDir: resolve(tempRoot, 'node_modules', 'tweetnacl'),
        manifest: { name: 'tweetnacl', version: '0.0.0', main: 'index.js' },
        files: {
          'index.js': 'module.exports = {};\n',
        },
      });
      writeNodeModuleStub({
        packageDir: resolve(tempRoot, 'node_modules', '@happier-dev', 'protocol', 'node_modules', 'base64-js'),
        manifest: { name: 'base64-js', version: '0.0.0', main: 'index.js' },
        files: {
          'index.js': 'module.exports = {};\n',
        },
      });
      writeNodeModuleStub({
        packageDir: resolve(tempRoot, 'node_modules', '@happier-dev', 'protocol', 'node_modules', '@noble', 'hashes'),
        manifest: { name: '@noble/hashes', version: '0.0.0', main: 'index.js' },
        files: {
          'hmac.js': 'export {};\n',
          'sha512.js': 'export {};\n',
        },
      });

      const result = runHappierBin({
        binDir,
        cwd: tempRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ok');
    } finally {
      cleanup();
    }
  });

  const presentStubs = {
    tweetnacl: { dir: ['tweetnacl'], manifest: { name: 'tweetnacl', version: '0.0.0', main: 'index.js' }, files: { 'index.js': 'module.exports = {};\n' } },
    'base64-js': { dir: ['base64-js'], manifest: { name: 'base64-js', version: '0.0.0', main: 'index.js' }, files: { 'index.js': 'module.exports = {};\n' } },
    '@noble/hashes/hmac': { dir: ['@noble', 'hashes'], manifest: { name: '@noble/hashes', version: '0.0.0', main: 'index.js' }, files: { 'hmac.js': 'export {};\n' } },
  } as const;

  // Each row installs every dependency checked before the missing one, so the
  // preflight reaches and names exactly that dependency.
  it.each([
    { missing: 'tweetnacl', present: [] },
    { missing: 'base64-js', present: ['tweetnacl'] },
    { missing: '@noble/hashes/hmac', present: ['tweetnacl', 'base64-js'] },
    { missing: '@noble/hashes/sha512', present: ['tweetnacl', 'base64-js', '@noble/hashes/hmac'] },
  ] as const)('prints a helpful error when $missing is missing', ({ missing, present }) => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const { rootDir: tempRoot, cleanup } = createCliBinPreflightSandbox('happier-bin-preflight-');

    try {
      const { binDir } = writeCliProjectFixture({
        projectRoot: tempRoot,
        entrypointDir: 'dist',
        entrypointContent: "console.log('ok');\n",
      });

      copyCliBinRuntimeFiles({ repoRoot, binDir });

      writeProtocolBundleStub({
        packageDir: resolve(tempRoot, 'node_modules', '@happier-dev', 'protocol'),
      });
      for (const name of present) {
        const stub = presentStubs[name];
        writeNodeModuleStub({
          packageDir: resolve(tempRoot, 'node_modules', ...stub.dir),
          manifest: stub.manifest,
          files: stub.files,
        });
      }

      const result = runHappierBin({
        binDir,
        cwd: tempRoot,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Missing required dependency: ${missing}`);
    } finally {
      cleanup();
    }
  });
});
