import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createStoredReadSchema } from '@happier-dev/protocol/json/storedReadSchema';
import { SessionOwnerCompatibilityViewV1Schema } from '@happier-dev/protocol/sessions/metadata/sessionMetadataSchemasV1';
import { logger } from '@/ui/logger';
import { recordPromptPreparationFailure } from './homeReadPreparationError';

describe('recordPromptPreparationFailure', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    'voice_target_binding_missing', 'voice_target_binding_invalid', 'voice_target_binding_target_is_carrier',
    'voice_target_binding_changed', 'voice_target_binding_control_retired',
  ])('retains a direct binding guard reason without inventing schema issues (%s)', code => {
    const logs = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    const error = Object.assign(new Error('private prompt, account and session'), {
      name: 'VoicePromptTargetBindingError', code, metadata: { sessionId: 'private-session' },
    });

    recordPromptPreparationFailure('target.binding', error);

    expect(logs).toHaveBeenCalledWith('[Session] Prompt preparation failed', {
      step: 'target.binding', errorClass: 'VoicePromptTargetBindingError', errorCode: code,
      causeClass: 'VoicePromptTargetBindingError', causeCode: code, kind: 'protocol_error',
    });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private');
  });

  it('retains real binding schema issue codes and paths without parse inputs or messages', () => {
    const logs = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    const binding = createStoredReadSchema(SessionOwnerCompatibilityViewV1Schema.shape.voiceConversationBindingV1)
      .safeParse({ v: 1, adapterId: 'private-adapter', controlSessionId: 'private-control',
        transcriptMode: 'private-mode', targetSessionId: null, updatedAt: 1 });
    expect(binding.success).toBe(false);
    if (binding.success) throw new Error('Expected malformed binding');
    const error = Object.assign(new Error('private binding failure', { cause: binding.error }), {
      name: 'VoicePromptTargetBindingError', code: 'voice_target_binding_invalid',
    });

    recordPromptPreparationFailure('target.binding', error);

    expect(logs).toHaveBeenCalledWith('[Session] Prompt preparation failed', {
      step: 'target.binding', errorClass: 'VoicePromptTargetBindingError', errorCode: 'voice_target_binding_invalid',
      causeClass: '$ZodError', causeCode: 'unclassified', kind: 'protocol_error',
      schemaIssues: [{ code: 'invalid_value', path: ['transcriptMode'] }],
    });
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/private|message|stack|input|received|expected|metadata/);
  });

  it('redacts dynamic schema path keys while preserving allowed fields and numeric positions', () => {
    const logs = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    const parsed = z.object({ voiceConversationBindingV1: z.record(z.string(), z.array(z.object({ targetSessionId: z.string() }))) })
      .safeParse({ voiceConversationBindingV1: { 'private-account-session': [{ targetSessionId: { secret: 'private-prompt' } }] } }, { reportInput: true });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected invalid record');
    const error = Object.assign(new Error('private error', { cause: parsed.error }), {
      name: 'VoicePromptTargetBindingError', code: 'voice_target_binding_invalid',
    });

    recordPromptPreparationFailure('target.binding', error);

    expect(logs).toHaveBeenCalledWith('[Session] Prompt preparation failed', expect.objectContaining({
      schemaIssues: [{ code: 'invalid_type', path: ['voiceConversationBindingV1', '[redacted]', 0, 'targetSessionId'] }],
    }));
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/private|secret|message|stack|input|received|expected/);
  });

  it('does not trust arbitrary issue codes, exception names or lookalike schema errors', () => {
    const logs = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    const parsed = z.object({ targetSessionId: z.string() }).safeParse({ targetSessionId: 1 });
    if (parsed.success) throw new Error('Expected invalid target');
    Reflect.set(parsed.error.issues[0], 'code', 'private-code');
    Reflect.set(parsed.error, 'name', 'private-class');
    recordPromptPreparationFailure('target.binding', Object.assign(new Error('private-message', { cause: parsed.error }), {
      name: 'private-wrapper', code: 'private-wrapper-code',
    }));
    recordPromptPreparationFailure('target.binding', { name: 'ZodError', issues: [{ code: 'invalid_type', path: ['targetSessionId'] }] });

    expect(logs.mock.calls[0]?.[1]).toMatchObject({
      errorClass: 'unclassified', errorCode: 'unclassified', causeClass: 'unclassified', causeCode: 'unclassified',
      schemaIssues: [{ code: 'unclassified', path: ['targetSessionId'] }],
    });
    expect(logs.mock.calls[1]?.[1]).not.toHaveProperty('schemaIssues');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private');
  });

  it('preserves the existing transport classification, deepest cause and safe reason', () => {
    const logs = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    const cause = Object.assign(new TypeError('private-content'), { code: 'ECONNRESET', status: 503 });
    recordPromptPreparationFailure('home.read', Object.assign(new Error('private-wrapper', { cause }), { status: 503 }), 'artifact_read_unavailable');
    expect(logs).toHaveBeenCalledWith('[Session] Prompt preparation failed', {
      step: 'home.read', errorClass: 'Error', errorCode: 'unclassified', causeClass: 'TypeError', causeCode: 'ECONNRESET',
      kind: 'server_error', statusCode: 503, reason: 'artifact_read_unavailable',
    });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private');
  });

  it('projects each untrusted name and code value before allowlisting it', () => {
    const logs = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    let nameReads = 0;
    let codeReads = 0;
    const error = Object.defineProperties(new Error('private-message'), {
      name: { get: () => ++nameReads <= 2 ? 'Error' : 'private-class' },
      code: { get: () => ++codeReads <= 2 ? 'ECONNRESET' : 'private-code' },
    });

    recordPromptPreparationFailure('target.binding', error);

    expect(JSON.stringify(logs.mock.calls)).not.toContain('private');
  });
});
