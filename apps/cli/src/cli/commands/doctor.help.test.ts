import { describe, expect, it } from 'vitest';

import type { CommandContext } from '@/cli/commandRegistry';
import { captureConsoleText } from '@/testkit/logger/captureOutput';
import { handleDoctorCliCommand } from './doctor';

function context(args: readonly string[]): CommandContext {
  return {
    args: [...args],
    rawArgv: ['node', 'happier', ...args],
    terminalRuntime: null,
  };
}

describe('happier doctor help', () => {
  it.each([
    ['--help'],
    ['-h'],
    ['help'],
  ])('renders top-level doctor help for `%s`', async (helpArg) => {
    const output = captureConsoleText();

    try {
      await handleDoctorCliCommand(context(['doctor', helpArg]));

      const text = output.text();
      expect(text).toContain('happier doctor');
      expect(text).toContain('System diagnostics and repair');
      expect(text).toContain('Usage:');
      expect(text).toContain('happier doctor repair');
    } finally {
      output.restore();
    }
  });
});
