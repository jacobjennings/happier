import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPluginTestkit, type PluginTestServicesFixture } from '@happier-dev/plugin-sdk/testing';
import type { HttpRequest } from '@happier-dev/plugin-sdk/http';
import { parsePluginManifest } from '@happier-dev/plugin-sdk/manifest';
import { MachineProvisionerOptionsResultV1Schema, projectMachineProvisionerSelectionV1 } from '@happier-dev/plugin-sdk/machine-provisioners';
import { deliverManagedNativeFile } from '../../../../apps/cli/src/machines/managed/nativeFileDelivery';
import { PLUGIN, PLUGIN_MANIFEST, MACHINE_PROVISIONER, ROLE_SCHEMAS } from './index.js';
import { reference, VercelLaunchSchema } from './machine/schemas.js';

const scope = { teamId: 'team_one', projectId: 'prj_one' };
const resource = { ...scope, name: 'happier-managed-1', managedId: 'managed-1', createdAt: 1000 };
const launch = { image: 'vercel/sandbox/universal:latest', region: 'iad1', vcpus: 2, timeoutMs: 300000, snapshotExpirationMs: 0 };
const dimensions = { size: [], image: [], location: [], network: [], duration: [] };
const selection = { size: '2', image: launch.image, location: 'iad1', duration: '300000' };
type Command = { command: string; args: string[]; attachStdin?: boolean; timeout?: number };
type Execution = { body: Command; stdin: Buffer[]; output?: { status: number; stdout: string; stderr: string }; sessionId: string };
async function vendor(home?: string, status: { project?: number; team?: number; accountFailure?: boolean } = {}) {
  const calls: HttpRequest[] = [];
  let currentSessionId = 'sbx_one', power = 'running', gone = false, snapshotGone = false;
  const commands = new Map<string, Execution>();
  const session = (id = currentSessionId) => ({ id, sourceSandboxName: resource.name, projectId: scope.projectId, createdAt: 1000 });
  const snapshot = () => ({ id: 'snap_one', sourceSessionId: 'sbx_one', status: snapshotGone ? 'deleted' : 'created', createdAt: 2000 });
  const named = () => ({ name: resource.name, createdAt: resource.createdAt, currentSessionId, currentSnapshotId: 'snap_one',
    status: power, persistent: true, tags: { 'happier-managed-id': resource.managedId } });
  function run(execution: Execution) {
    if (execution.output) return execution.output;
    if (!home) { execution.output = { status: 0, stdout: '', stderr: '' }; return execution.output; }
    try {
      // REST represents the explicitly requested Linux/AMD64 guest, not the
      // executor CPU. Keep Home expansion and all filesystem/daemon IO real.
      const args = execution.body.command === 'sh' && execution.body.args[0] === '-c'
        && execution.body.args[1] === 'uname -s; uname -m; printf "%s\\n" "$HOME"'
        ? ['-c', 'printf "%s\\n" Linux x86_64 "$HOME"'] : execution.body.args;
      const output = execFileSync(execution.body.command, args, {
        input: Buffer.concat(execution.stdin), env: { ...process.env, HOME: home }, encoding: 'utf8',
      });
      execution.output = { status: 0, stdout: output, stderr: '' };
    } catch (error) {
      const failed = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      execution.output = { status: failed.status ?? 1, stdout: String(failed.stdout ?? ''), stderr: String(failed.stderr ?? '') };
    }
    return execution.output;
  }
  const services = {
    connectedAccounts: { async materialize(_purpose: string, request: { kind: string }) {
      if (status.accountFailure) throw Object.assign(new Error('private credential details'), { code: 'credential_unavailable' });
      return request.kind === 'environment'
        ? { kind: 'environment' as const, env: { VERCEL_TEAM_ID: scope.teamId, VERCEL_PROJECT_ID: scope.projectId } }
        : { kind: 'httpHeaders' as const, headers: { Authorization: 'Bearer private-controller-token' } };
    } },
    http: { async request(request: HttpRequest) {
      calls.push(request);
      const url = new URL(request.url), method = request.method;
      let value: unknown, responseStatus = 200, contentType = 'application/json';
      const path = url.pathname;
      if (path.startsWith('/v9/projects/')) { value = { id: scope.projectId }; responseStatus = status.project ?? 200; }
      else if (path.startsWith('/v2/teams/')) { value = { id: scope.teamId, billing: { plan: 'hobby' } }; responseStatus = status.team ?? 200; }
      else if (path === '/v4/sandboxes') value = { sandbox: named(), session: session(), routes: [] };
      else if (path === '/v2/sandboxes/' + resource.name) {
        if (method === 'DELETE') { gone = true; if (url.searchParams.get('deleteOrphanSnapshots') === 'true') snapshotGone = true; }
        else if (url.searchParams.get('resume') === 'true') { currentSessionId = 'sbx_two'; power = 'running'; }
        responseStatus = gone && method !== 'DELETE' ? 404 : 200;
        value = { sandbox: named(), session: session(), resumed: false, routes: [] };
      } else if (path === '/v2/sandboxes/snapshots') {
        value = { snapshots: snapshotGone ? [] : [snapshot()], pagination: { next: null, count: snapshotGone ? 0 : 1 } };
      } else if (path.includes('/snapshots/')) {
        if (method === 'DELETE') snapshotGone = true;
        value = { snapshot: snapshot() };
      } else if (path.endsWith('/stop')) {
        power = 'stopped'; value = { sandbox: named(), session: session(), snapshot: snapshot() };
      } else if (/\/sessions\/[^/]+$/.test(path)) value = { session: session(path.split('/').at(-1)) };
      else if (path.endsWith('/cmd')) {
        const body: Command = JSON.parse(new TextDecoder().decode(request.body));
        const id = 'cmd_' + commands.size;
        commands.set(id, { body, stdin: [], sessionId: path.split('/')[4]! });
        value = { command: { id, sessionId: currentSessionId, exitCode: null } };
      } else if (path.includes('/cmd/')) {
        const [, commandId, suffix] = path.split('/cmd/')[1]!.match(/^([^/]+)(?:\/(.*))?$/) ?? [];
        const execution = commands.get(commandId!)!;
        if (suffix === 'stdin') {
          const body: { data: string; offset: number; close: boolean } = JSON.parse(new TextDecoder().decode(request.body));
          expect(Buffer.byteLength(new TextDecoder().decode(request.body))).toBeLessThanOrEqual(1_000_000);
          expect(body.offset).toBe(Buffer.concat(execution.stdin).length);
          execution.stdin.push(Buffer.from(body.data, 'base64'));
          if (body.close) run(execution);
          value = { bytesWritten: Buffer.concat(execution.stdin).length };
        } else if (suffix === 'logs') {
          const result = run(execution);
          value = JSON.stringify({ stream: 'stdout', data: result.stdout }) + '\n' + JSON.stringify({ stream: 'stderr', data: result.stderr }) + '\n';
          contentType = 'application/x-ndjson';
        } else value = { command: { id: commandId, sessionId: execution.sessionId, exitCode: run(execution).status } };
      } else throw new Error('Unexpected vendor endpoint ' + path);
      return { status: responseStatus, finalUrl: request.url, headers: { 'content-type': contentType },
        body: new TextEncoder().encode(contentType === 'application/x-ndjson' ? String(value) : JSON.stringify(value)) };
    } },
  } satisfies PluginTestServicesFixture;
  const kit = await createPluginTestkit({ manifest: PLUGIN_MANIFEST, module: PLUGIN, services });
  return { kit, calls, setStopped() { power = 'stopped'; }, commands };
}

describe('public Vercel provisioner composition', () => {
  it.each([{ project: 404 }, { team: 503 }])('distinguishes native options unavailability from an incomplete draft (%j)', async status => {
    const { kit } = await vendor(undefined, status);
    try {
      expect(await kit.invokeAction('options', launch, { surface: 'plugin' })).toEqual({ dimensions, code: 'provider_unavailable',
        nativeCause: { httpStatusClass: status.project ? '4xx' : '5xx' } });
    } finally { await kit.dispose(); }
    const available = await vendor();
    try { expect(await available.kit.invokeAction('options', {}, { surface: 'plugin' })).toEqual({ dimensions }); }
    finally { await available.kit.dispose(); }
  });
  it('admits strict descriptor/roles and rejects unsupported Suspend and unknown launch fields', () => {
    expect(parsePluginManifest(PLUGIN_MANIFEST).ok).toBe(true);
    expect(MACHINE_PROVISIONER.retention.supportedIntents).toEqual(['start','stop','resume','delete']);
    expect(ROLE_SCHEMAS.acquireInput.safeParse({ managedId: resource.managedId, launch: { ...launch, token: 'not-public' } }).success).toBe(false);
  });
  it('invokes the activated check and options through host HTTP without waking or guest IO', async () => {
    const { kit, calls } = await vendor();
    try {
      expect(await kit.invokeAction('check', {}, { surface: 'plugin' })).toMatchObject({ available: true });
      const options = MachineProvisionerOptionsResultV1Schema.parse(await kit.invokeAction('options', launch, { surface: 'plugin' }));
      expect(options).not.toHaveProperty('choices');
      expect(Object.fromEntries(Object.entries(options.dimensions).map(([key, values]) => [key, values.length])))
        .toEqual({ size: 1, image: 1, location: 1, network: 0, duration: 1 });
      const projection = projectMachineProvisionerSelectionV1({ options, selection, launchSchema: VercelLaunchSchema.jsonSchema });
      expect(projection).toMatchObject({
        kind: 'ready', launch, nativeFacts: { size: { cpuCores: 2, memoryBytes: 4294967296 } },
      });
      if (projection.kind !== 'ready') throw new Error('Expected reviewed launch');
      expect(ROLE_SCHEMAS.acquireInput.parse({ managedId: resource.managedId, launch: projection.launch }).launch).toEqual(launch);
      expect(projectMachineProvisionerSelectionV1({ options, selection: {}, launchSchema: VercelLaunchSchema.jsonSchema }))
        .toMatchObject({ kind: 'incomplete' });
      expect(calls).toHaveLength(3);
      expect(calls.every(call => call.method === 'GET' && !/cmd|fs/.test(new URL(call.url).pathname))).toBe(true);
      expect(calls.every(call => call.headers?.authorization === 'Bearer private-controller-token')).toBe(true);
    } finally { await kit.dispose(); }
  });
  it('keeps plan-refused options unavailable through the canonical selection projector', async () => {
    const { kit, calls } = await vendor();
    try {
      const options = MachineProvisionerOptionsResultV1Schema.parse(await kit.invokeAction('options', { ...launch, vcpus: 8 }, { surface: 'plugin' }));
      expect(projectMachineProvisionerSelectionV1({ options, selection: { ...selection, size: '8' }, launchSchema: VercelLaunchSchema.jsonSchema }))
        .toMatchObject({ kind: 'unavailable' });
      expect(calls.every(call => call.method === 'GET')).toBe(true);
    } finally { await kit.dispose(); }
  });
  it('keeps timeout stops resumable through the activated inspector', async () => {
    const host = await vendor();
    host.setStopped();
    try {
      expect(await host.kit.invokeAction('inspect', { resource }, { surface: 'plugin' })).toMatchObject({
        availability: 'present', power: 'stopped', storage: 'retained',
      });
      expect(host.calls.every(call => call.method === 'GET' && new URL(call.url).searchParams.get('resume') !== 'true')).toBe(true);
    } finally { await host.kit.dispose(); }
  });
  it('projects an inspect credential exception as unknown without asserting absence', async () => {
    const { kit, calls } = await vendor(undefined, { accountFailure: true });
    try {
      expect(await kit.invokeAction('inspect', { resource }, { surface: 'plugin' })).toMatchObject({
        availability: 'unavailable', reason: 'credential_unavailable',
      });
      expect(calls).toEqual([]);
    } finally { await kit.dispose(); }
  });
  it.skipIf(process.platform === 'win32')('probes actual home and restarts the installed daemon recipe on the same retained filesystem', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vercel-guest-'));
    await mkdir(join(home, '.happier'));
    const host = await vendor(home);
    try {
      expect(await host.kit.invokeAction('bootstrap', { resource }, { surface: 'plugin' })).toMatchObject({
        kind: 'native', guestHome: { homeDir: home, happyHomeDir: home + '/.happier', daemonStartup: 'native-process' },
      });
      const marker = join(home, 'daemon-starts');
      const input = { resource, argv: ['sh', '-c', 'exit 99'], processConfig: {
        environment: { HOME: home, HAPPIER_HOME_DIR: home + '/.happier' },
        detachedDaemonStartArgv: ['sh', '-c', "printf 'started\\n' >> '" + marker + "'"],
      } };
      expect(await host.kit.invokeAction('exec', input, { surface: 'plugin' })).toEqual({ kind: 'process-configured' });
      host.setStopped();
      expect(await host.kit.invokeAction('power', { resource, intent: 'resume' }, { surface: 'plugin' })).toEqual({ kind: 'confirmed' });
      expect(await readFile(marker, 'utf8')).toBe('started\nstarted\n');
      expect(host.calls.filter(call => new URL(call.url).pathname === '/v4/sandboxes')).toEqual([]);
      expect((await readFile(join(home, '.happier', 'vercel-daemon-start'), 'utf8'))).toContain('daemon-starts');
    } finally { await host.kit.dispose(); await rm(home, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform === 'win32')('delivers a binary installer fragment through the host assembly owner and private REST stdin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vercel-file-'));
    const host = await vendor(home);
    const source = join(home, 'source'), destination = join(home, "payload's-installed");
    const expected = Buffer.alloc(800000, 0xa5); expected[0] = 0; expected[expected.length - 1] = 0xff;
    await writeFile(source, expected);
    try {
      await deliverManagedNativeFile({ localPath: source, guestPath: destination, resource }, {
        async putFile(request) {
          const result = await host.kit.invokeAction('put-file', { resource, guestPath: request.path, bytesBase64: Buffer.from(request.bytes).toString('base64') }, { surface: 'plugin' });
          expect(result).toEqual({ kind: 'confirmed' });
        },
        async exec(request) {
          const result = execFileSync('sh', ['-c', request.command], { encoding: 'utf8' });
          return { status: 0, stdout: result, stderr: '' };
        },
      });
      expect(await readFile(destination)).toEqual(expected);
      const starts = host.calls.filter(call => new URL(call.url).pathname.endsWith('/cmd'));
      expect(starts.every(call => !new TextDecoder().decode(call.body).includes(expected.toString('base64')))).toBe(true);
      expect(host.calls.filter(call => new URL(call.url).pathname.endsWith('/stdin'))).toHaveLength(2);
    } finally { await host.kit.dispose(); await rm(home, { recursive: true, force: true }); }
  });
  it('deletes only source-proven snapshots and confirms cleanup through the same host roles', async () => {
    const host = await vendor();
    try {
      const retained = { kind: 'delete', resource, phase: 'delete', snapshotIds: ['snap_one'] };
      expect(await host.kit.invokeAction('destroy', { resource }, { surface: 'plugin' })).toEqual({ kind: 'accepted', nativeOperationRef: reference(retained) });
      // The shared row persists this handle before the next native deletion.
      expect(host.calls.some(call => call.method === 'DELETE')).toBe(false);
      expect(await host.kit.invokeAction('destroy', { nativeOperation: retained }, { surface: 'plugin' })).toEqual({ kind: 'confirmed' });
      const deletes = host.calls.filter(call => call.method === 'DELETE').map(call => new URL(call.url).pathname);
      expect(deletes).toEqual(['/v2/sandboxes/' + resource.name]);
      expect(host.calls.find(call => call.method === 'DELETE')?.url).toContain('deleteOrphanSnapshots=true');
      expect(host.calls.filter(call => new URL(call.url).pathname === '/v2/sandboxes/snapshots')
        .every(call => new URL(call.url).searchParams.get('name') === resource.name)).toBe(true);
    } finally { await host.kit.dispose(); }
  });
});
