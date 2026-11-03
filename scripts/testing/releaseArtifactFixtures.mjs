// Release artifact test fixtures shared by release contract tests.
//
// - Minisign envelopes are real Ed25519 signatures the canonical verifier
//   (@happier-dev/release-runtime/minisign) accepts, so tests exercise actual signature
//   verification instead of stubbing a `minisign` binary.
// - Base CLI payload files satisfy verify-artifacts' always-on CLI runtime attestation.
//   When HAPPIER_TEST_RUNTIME_SMOKE_MARKER is set, each smoke step appends its marker
//   there so a test can prove which runtime boundaries were exercised.

import { generateKeyPairSync, sign } from 'node:crypto';

const LEGACY_ED25519_ALGORITHM = Buffer.from('Ed');

/**
 * @param {{ keyIdByte?: number; trustedComment?: string }} [options]
 * @returns {{ publicKeyFile: string; sign: (message: string | Uint8Array) => string }}
 */
export function createMinisignTestSigner({ keyIdByte = 1, trustedComment = 'happier release test' } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.alloc(8, keyIdByte);
  const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const publicKeyFile = `untrusted comment: minisign test public key\n${
    Buffer.concat([LEGACY_ED25519_ALGORITHM, keyId, rawPublicKey]).toString('base64')
  }\n`;
  return {
    publicKeyFile,
    sign(message) {
      const signature = sign(null, Buffer.from(message), privateKey);
      const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), privateKey);
      return [
        'untrusted comment: signature from minisign test key',
        Buffer.concat([LEGACY_ED25519_ALGORITHM, keyId, signature]).toString('base64'),
        `trusted comment: ${trustedComment}`,
        globalSignature.toString('base64'),
        '',
      ].join('\n');
    },
  };
}

export function createBaseCliRuntimeSmokeFixtureFiles(version) {
  const markerWrite = "appendFileSync(process.env.HAPPIER_TEST_RUNTIME_SMOKE_MARKER || devNull, ";
  const cjsMarkerPath = "(process.env.HAPPIER_TEST_RUNTIME_SMOKE_MARKER || require('node:os').devNull)";
  return {
    happier: `#!/usr/bin/env bash\nprintf '%s\\n' '${version}'\n`,
    'tools/unpacked/rg': `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == '--version' ]]; then
  printf 'rg-version\\n' >> "\${HAPPIER_TEST_RUNTIME_SMOKE_MARKER:-/dev/null}"
  printf 'ripgrep 14.1.0\\n'
  exit 0
fi
printf 'rg-search\\n' >> "\${HAPPIER_TEST_RUNTIME_SMOKE_MARKER:-/dev/null}"
pattern="\${@: -2:1}"
file="\${@: -1}"
grep -F -- "$pattern" "$file"
`,
    'tools/unpacked/zellij': `#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == '--version' ]]
printf 'zellij-version\\n' >> "\${HAPPIER_TEST_RUNTIME_SMOKE_MARKER:-/dev/null}"
printf 'zellij 0.44.3\\n'
`,
    'package-dist/index.mjs': `
      import { appendFileSync } from 'node:fs';
      import { devNull } from 'node:os';
      if (!process.argv.includes('--version')) throw new Error('package-dist version flag missing');
      if (process.env.NODE_PATH) throw new Error('package-dist inherited NODE_PATH');
      ${markerWrite}'package-dist-version\\n');
      console.log(${JSON.stringify(version)});
    `,
    'node_modules/@modelcontextprotocol/sdk/package.json': JSON.stringify({
      name: '@modelcontextprotocol/sdk', type: 'module',
      exports: {
        './client/index.js': { require: './dist/cjs/client/index.cjs' },
        './inMemory.js': { require: './dist/cjs/inMemory.cjs' },
        './server/mcp.js': { require: './dist/cjs/server/mcp.cjs' },
      },
    }),
    'node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.cjs': `
      const { appendFileSync } = require('node:fs');
      appendFileSync(${cjsMarkerPath}, 'mcp-cjs\\n');
      const mark = (value) => appendFileSync(${cjsMarkerPath}, value + '\\n');
      exports.Client = class Client {
        async connect(transport) { this.transport = transport; }
        async ping() { if (!this.transport.other.server) throw new Error('MCP server missing'); mark('mcp-ping'); return {}; }
        async listTools() { mark('mcp-list'); return { tools: this.transport.other.server.tools }; }
        async callTool({ name, arguments: args }) {
          mark('mcp-call');
          return await this.transport.other.server.tools.find((entry) => entry.name === name).handler(args);
        }
        async close() {}
      };
    `,
    'node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.cjs': `
      const { appendFileSync } = require('node:fs');
      exports.McpServer = class McpServer {
        constructor() {
          this.tools = [];
          appendFileSync(${cjsMarkerPath}, 'mcp-server\\n');
        }
        registerTool(name, _metadata, handler) { this.tools.push({ name, handler }); }
        async connect(transport) { transport.server = { tools: this.tools }; }
        async close() {}
      };
    `,
    'node_modules/@modelcontextprotocol/sdk/dist/cjs/inMemory.cjs': `
      exports.InMemoryTransport = class InMemoryTransport {
        static createLinkedPair() {
          const client = {};
          const server = {};
          client.other = server;
          server.other = client;
          return [client, server];
        }
      };
    `,
    'node_modules/zod/package.json': JSON.stringify({
      name: 'zod', type: 'module', exports: { '.': { import: './index.js', require: './index.cjs' } },
    }),
    'node_modules/zod/index.js': "export const z = { string: () => ({ type: 'string' }) };\n",
    'node_modules/zod/index.cjs': "exports.z = { string: () => ({ type: 'string' }) };\n",
    'node_modules/sharp/package.json': JSON.stringify({ name: 'sharp', main: './index.cjs' }),
    'node_modules/sharp/index.cjs': `
      const { appendFileSync } = require('node:fs');
      module.exports = function sharp({ create }) {
        if (create.width !== 1 || create.height !== 1) throw new Error('sharp smoke must encode 1x1');
        return { png: () => ({ toBuffer: async () => {
          appendFileSync(${cjsMarkerPath}, 'sharp\\n');
          return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        } }) };
      };
    `,
    'node_modules/@homebridge/node-pty-prebuilt-multiarch/package.json': JSON.stringify({
      name: '@homebridge/node-pty-prebuilt-multiarch', main: './index.cjs',
    }),
    'node_modules/@homebridge/node-pty-prebuilt-multiarch/index.cjs': `
      require('node:fs').appendFileSync(${cjsMarkerPath}, 'homebridge\\n');
      exports.spawn = () => {};
    `,
    'node_modules/node-pty/package.json': JSON.stringify({ name: 'node-pty', main: './index.cjs' }),
    'node_modules/node-pty/index.cjs': `
      const childProcess = require('node:child_process');
      const { appendFileSync } = require('node:fs');
      exports.spawn = (command, args, options) => {
        if (process.platform !== 'win32' && (command !== '/bin/sh' || args.join(' ') !== '-c printf pty-ok')) {
          throw new Error('node-pty smoke did not use the real POSIX shell recipe');
        }
        appendFileSync(${cjsMarkerPath}, 'node-pty\\n');
        const child = childProcess.spawn(command, args, { cwd: options.cwd, env: options.env });
        return {
          onData(handler) { child.stdout.on('data', (chunk) => handler(chunk.toString())); },
          onExit(handler) { child.on('exit', (exitCode, signal) => handler({ exitCode, signal })); },
        };
      };
    `,
  };
}

export function createWindowsBaseCliRuntimeSmokeFixtureFiles(version) {
  const files = createBaseCliRuntimeSmokeFixtureFiles(version);
  files['happier.exe'] = files.happier;
  files['tools/unpacked/rg.exe'] = files['tools/unpacked/rg'];
  delete files.happier;
  delete files['tools/unpacked/rg'];
  delete files['tools/unpacked/zellij'];
  return files;
}
