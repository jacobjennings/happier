import { describe, expect, it } from 'vitest';

import { captureStdout } from '@/testkit/logger/captureOutput';

import { handleCompletionCliCommand } from './completion';

describe('completion command', () => {
  it.each([
    ['bash', 'complete -F _happier_completion happier', /2>\/dev\/null/u],
    ['zsh', 'compdef _happier_completion happier', /2>\/dev\/null/u],
    ['fish', 'complete -c happier', /2>\/dev\/null/u],
    ['powershell', 'Register-ArgumentCompleter -Native -CommandName happier', /2>\$null/u],
  ] as const)('emits a pure %s completion script that keeps completion failures quiet', async (shell, marker, quietStderrRedirect) => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', shell], rawArgv: ['happier', 'completion', shell], terminalRuntime: null,
      });
      expect(output.chunks).toHaveLength(1);
      expect(output.text()).toContain(marker);
      expect(output.text()).not.toContain('node ');
      expect(output.text()).not.toContain('npm ');
      expect(output.text()).toMatch(quietStderrRedirect);
    } finally {
      output.restore();
    }
  });

  it('uses native token arrays instead of reparsing Fish command text', async () => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', 'fish'], rawArgv: ['happier', 'completion', 'fish'], terminalRuntime: null,
      });

      expect(output.text()).toContain('set -l words (commandline -xpc)');
      expect(output.text()).toContain('$words[2..]');
      expect(output.text()).not.toContain('commandline -opc');
      expect(output.text()).not.toContain("string split ' '");
    } finally {
      output.restore();
    }
  });

  it('drops only the executable word from the Zsh argv array', async () => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', 'zsh'], rawArgv: ['happier', 'completion', 'zsh'], terminalRuntime: null,
      });

      expect(output.text()).toContain('"${words[@]:1}"');
      expect(output.text()).not.toContain('"${words[@]:2}"');
    } finally {
      output.restore();
    }
  });

  it('forwards dequoted PowerShell string values without evaluating command text', async () => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', 'powershell'], rawArgv: ['happier', 'completion', 'powershell'], terminalRuntime: null,
      });

      expect(output.text()).toContain('StringConstantExpressionAst');
      expect(output.text()).toContain('$element.Value');
      expect(output.text()).not.toContain('ForEach-Object { $_.Extent.Text }');
      expect(output.text()).not.toContain('Where-Object');
    } finally {
      output.restore();
    }
  });
});
