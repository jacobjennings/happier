import { describe, expect, it } from 'vitest';

import { captureConsoleText } from '@/testkit/logger/captureOutput';

import { showAuthHelp } from './auth/help';
import { showMachineHelp } from './machine/help';
import { showRelayHelp } from './relay/help';
import { handleAgentsCommand } from './agents';

describe('CLI help output standardization', () => {
  // Each page is rendered on its own so one page's Usage section cannot satisfy another's.
  it.each([
    ['auth', () => showAuthHelp(), ['happier auth', 'Usage:', 'Options:']],
    ['machine', () => showMachineHelp(), ['happier machine', 'Set up remote machines', 'Usage:', '--ssh-user <user>', '--ssh-host <host>']],
    ['relay', () => showRelayHelp(), ['happier relay', 'Usage:', 'happier relay access status', '--ssh-auth agent|keyfile|password', '--upstream-url <url>']],
    ['agents', async () => await handleAgentsCommand(['help']), ['happier agents', 'Agent CLI helpers', 'Usage:']],
  ] as const)('renders the %s help page with a Usage section and its documented flags', async (_page, render, expectedContents) => {
    const output = captureConsoleText();
    try {
      await render();
      const text = output.text();
      for (const expected of expectedContents) {
        expect(text).toContain(expected);
      }
    } finally {
      output.restore();
    }
  });
});
