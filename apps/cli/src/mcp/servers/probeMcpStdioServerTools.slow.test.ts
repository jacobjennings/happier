import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { probeMcpStdioServerTools } from './probeMcpStdioServerTools';

// A real child process owns the external MCP boundary; no internal probe logic is mocked.
// Each phase deliberately answers after 16 s, beyond the former 15 s Test-only cutoff,
// which is why this contract lives in the slow lane.
const fixture = String.raw`
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = {
    protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'probe-fixture', version: '1.0.0' }
  };
  else if (request.method === 'tools/list') {
    result = request.params?.cursor === 'second'
      ? { tools: [{ name: 'later_page', inputSchema: { type: 'object' } }] }
      : { tools: [{ name: 'first_page', inputSchema: { type: 'object' } }], nextCursor: 'second' };
  } else return;
  const respond = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  const slow = (request.method === 'initialize' && process.argv[1] === 'slow-initialize')
    || (request.method === 'tools/list' && !request.params?.cursor && process.argv[1] === 'slow-list');
  if (slow) setTimeout(respond, 16_000);
  else respond();
});
`;

describe('probeMcpStdioServerTools (slow lifetimes)', () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });

  it.each(['slow-initialize', 'slow-list'])('allows %s beyond the former Test-only cutoff within the caller and SDK lifetime', async mode => {
    const directory = await mkdtemp(join(tmpdir(), 'happier-mcp-probe-slow-'));
    directories.push(directory);
    const config = { command: process.execPath, args: ['-e', fixture, mode] };
    const controller = new AbortController();
    await expect(probeMcpStdioServerTools({ config, signal: controller.signal })).resolves.toMatchObject({
      tools: [{ name: 'first_page' }, { name: 'later_page' }],
      serverInfo: { name: 'probe-fixture', version: '1.0.0' },
    });
  }, 30_000);
});
