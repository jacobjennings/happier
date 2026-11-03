import { describe, expect, it, vi } from 'vitest';

import { captureConsoleLogAndMuteStdout } from '@/testkit/logger/captureOutput';

vi.mock('@/rpc/handlers/capabilities', () => {
  throw new Error('agents list/status must not import the capability service');
});

describe('happier agents read-only JSON import purity', () => {
  it.each([
    ['list', 'agents_list'],
    ['status', 'agents_status'],
  ] as const)('prints %s JSON without importing probe/install capabilities', async (subcommand, expectedKind) => {
    const { handleAgentsCommand } = await import('./agents');
    const output = captureConsoleLogAndMuteStdout();
    try {
      await handleAgentsCommand([subcommand, '--json']);
      const parsed = JSON.parse(output.logs.join('\n').trim());
      expect(parsed).toMatchObject({
        v: 1,
        ok: true,
        kind: expectedKind,
      });
    } finally {
      output.restore();
    }
  });
});
