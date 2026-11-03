import { describe, expect, it } from 'vitest';
import { findCompiledActionCliCommand, listCompiledActionCliCommands } from '@/cli/actions/compiledCommands';
import { composeActionCliInput, parseActionCliInput } from '@/cli/actions/parseCommandInput';

describe('happier notify Action surface', () => {
  it('preserves aliases and channel selection through the generated Action schema', () => {
    const command = findCompiledActionCliCommand(['notify'], listCompiledActionCliCommands());
    expect(command?.actionId).toBe('notifications.notify_me');
    if (!command) throw new Error('notify command unavailable');
    const parsed = parseActionCliInput(command, ['-p', 'Deployment ready', '-t', 'Deploy', '--channels', 'builtin:expo_push']);
    expect(parsed.ok, parsed.ok ? undefined : parsed.message).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(composeActionCliInput({ parsed, canonicalSchema: command.spec.inputSchema,
      callerSchema: command.callerSchema, bindInput: command.spec.cli?.bindInput,
      context: { actionId: command.actionId, invocationId: 'notify-1', output: 'json' },
    })).toMatchObject({ ok: true, input: { message: 'Deployment ready', title: 'Deploy', channels: ['builtin:expo_push'] } });
  });

  it('keeps a declared alias literal after the option terminator', () => {
    const command = findCompiledActionCliCommand(['notify'], listCompiledActionCliCommands());
    if (!command) throw new Error('notify command unavailable');
    expect(parseActionCliInput(command, ['--', '-p'])).toMatchObject({ ok: true, callerOverlay: { message: '-p' } });
  });
});
