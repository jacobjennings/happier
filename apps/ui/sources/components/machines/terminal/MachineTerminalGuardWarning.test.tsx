import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineGuardPolicyV1Schema } from '@happier-dev/protocol/machines/guard/guardPolicyV1';
import type { MachineGuardViewV1 } from '@happier-dev/protocol/machines/guard/guardRpcV1';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { renderScreen } from '@/dev/testkit';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createHomeGovernanceHarness, installHomeGovernanceBoundaries } from '@/dev/testkit/harness/homeGovernanceHarness';
import { installDisconnectedServerSocketBoundary } from '@/dev/testkit/harness/serverAccountConnectionHarness';
import { createMachineGuardViewFixture } from '@/sync/domains/machines/guard/guardViewFixtures';

installDisconnectedServerSocketBoundary();
const transport = vi.hoisted(() => ({ rpc: vi.fn() }));
// Only the Machine network is replaced; credentials, the Actions front door, the Guard store and the warning run for real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: transport.rpc }));
const home = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(home);
const { machineGuardStore } = await import('@/sync/domains/machines/guard/machineGuardStore');
const { storage } = await import('@/sync/domains/state/storageStore');
const { MachineTerminalGuardWarning } = await import('./MachineTerminalGuardWarning');

const terminalRow = (overrides: Partial<NonNullable<MachineGuardViewV1['idleTerminals']>[number]> = {}) => ({
  terminalId: 't-1', terminalKey: 'machine-shell:machine:1', label: 'Terminal', idleMs: 7_200_000, eligible: true,
  commandRunning: true, status: 'stops_at' as const, stopAt: Date.now() + 272_000, reasons: [] as never[], ...overrides,
});

async function mount(rows: NonNullable<MachineGuardViewV1['idleTerminals']>, kept: unknown[] = []) {
  const serverId = await home.addHome({ name: 'Terminal Guard Home', serverUrl: `https://terminal-guard-${Math.random().toString(36).slice(2)}.test`,
    serverIdentityId: 'srv_terminal_guard', accountId: 'owner' });
  home.answer(serverId, '/v2/account/settings', { body: { content: { t: 'plain', v: {} }, version: 1 } });
  storage.setState({ machines: {}, machineListByServerId: { [serverId]: [createMachineFixture({ id: 'machine', active: true, activeAt: Date.now(),
    storageMode: 'plain', isShared: false,
    metadata: { host: 'devbox', platform: 'linux', happyCliVersion: '0.3.0', happyHomeDir: '/home/dev/.happier', homeDir: '/home/dev' },
    access: { role: 'manage', custodian: { accountId: 'owner', displayName: 'Owner' }, resourceMode: 'plain', accessState: 'ready' } })] },
  machineListStatusByServerId: { [serverId]: 'idle' } });
  transport.rpc.mockImplementation(async ({ method, payload }: { method: string; payload: Record<string, unknown> }) => {
    if (method === RPC_METHODS.DAEMON_GUARD_WATCH || method === RPC_METHODS.DAEMON_GUARD_ACTIVITY_WATCH) return new Promise(() => {});
    if (method === RPC_METHODS.MACHINES_GUARD_GET) return createMachineGuardViewFixture({
      policy: MachineGuardPolicyV1Schema.parse({ idleTerminals: { enabled: true } }), idleTerminals: rows });
    if (method === RPC_METHODS.MACHINES_GUARD_IDLE_STOP_KEEP_RUNNING) { kept.push(payload); return { status: 'kept' }; }
    throw new Error(`unexpected ${method}`);
  });
  const screen = await renderScreen(<MachineTerminalGuardWarning serverId={serverId} machineId="machine" terminalKey="machine-shell:machine:1" />);
  return { screen };
}

const before = storage.getState();
beforeEach(async () => { await home.reset(); machineGuardStore.reset(); transport.rpc.mockReset(); });
afterEach(async () => { standardCleanup(); machineGuardStore.reset(); storage.setState(before); await home.reset(); });

describe('MachineTerminalGuardWarning', () => {
  it('warns that the running command is about to be closed and keeps this terminal running through its own Action', async () => {
    const kept: unknown[] = [];
    const { screen } = await mount([terminalRow()], kept);
    await act(async () => { await vi.waitFor(() => expect(screen.findByTestId('machine-terminal-guard-warning')).not.toBeNull()); });
    expect(screen.getTextContent()).toMatch(/Closes in 4:\d\d/);
    await act(async () => { screen.pressByTestId('machine-terminal-guard-warning-keep'); });
    await act(async () => { await vi.waitFor(() => expect(kept).toHaveLength(1)); });
    expect(kept[0]).toMatchObject({ machineId: 'machine', terminalKey: 'machine-shell:machine:1' });
  });

  it('stays quiet for other terminals, a terminal at its prompt and one that is not yet stopping', async () => {
    const { screen } = await mount([
      terminalRow({ terminalKey: 'someone-elses' }),
      terminalRow({ commandRunning: false }),
      terminalRow({ status: 'not_yet', stopAt: undefined }),
    ]);
    await act(async () => { await vi.waitFor(() => expect(transport.rpc.mock.calls.some(([request]) => request.method === RPC_METHODS.MACHINES_GUARD_GET)).toBe(true)); });
    expect(screen.findByTestId('machine-terminal-guard-warning')).toBeNull();
  });
});
