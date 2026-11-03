import { PromptStackPreparationError, type PromptStackPreparationReason } from '@happier-dev/protocol/prompts/library/resolvePromptStackSystemAppendBlocksV1';
import type { PromptArtifactRefV1 } from '@happier-dev/protocol/prompts/library/promptArtifactRefsV1';
import { $ZodError } from 'zod/v4/core';
import { NETWORK_ERROR_CODES, classifyServerEndpointError, type ServerEndpointErrorClassification } from '@/api/client/classifyServerEndpointError';
import { logger } from '@/ui/logger';

/** A classified Home read, without the HTTP body, request config or original message. */
export class HomeReadPreparationError extends Error {
  constructor(readonly classification: ServerEndpointErrorClassification) {
    super('Home preparation read failed');
    this.name = 'HomeReadPreparationError';
  }
}

/** Role and prompt preparation share Home transport policy; the runner owns recovery. */
export function classifyHomeReadPreparationError(error: unknown, ref?: PromptArtifactRefV1): unknown {
  if (error instanceof PromptStackPreparationError) return error;
  const classification = classifyServerEndpointError(error);
  const { retryable, statusCode } = classification;
  if (!retryable && !(statusCode !== undefined && statusCode >= 400 && statusCode < 500)) return error;
  // The Artifact owner returns null for a missing document. Its thrown 404 is
  // an unavailable read endpoint, not authority to omit an optional attachment.
  const artifactReadUnavailable = error instanceof Error && 'code' in error && error.code === 'artifact_read_unavailable';
  const reason: PromptStackPreparationReason = retryable ? 'unavailable'
    : statusCode === 401 || statusCode === 403 ? 'locked'
    : statusCode === 404 && !artifactReadUnavailable ? 'not_found' : 'malformed';
  recordPromptPreparationFailure('home.read', error);
  // Protocol adds partial admission facts by rebuilding the preparation error.
  // Its existing cause carrier preserves this safe Home fact for startup recovery.
  return Object.assign(new PromptStackPreparationError(reason, ref), { cause: new HomeReadPreparationError(classification) });
}


export type PromptPreparationStep =
  | 'home.read' | 'target.credentials' | 'target.currentness' | 'target.session' | 'target.metadata' | 'target.binding' | 'target.home'
  | 'role' | 'role.account-settings' | 'project' | 'profile' | 'profile.currentness'
  | 'lifetime' | 'prompt-library.read' | 'prompt-library.storage' | 'prompt-library.voice' | 'prompt-library.sources'
  | 'artifact' | 'artifact.header' | 'artifact.scope' | 'memory';

const diagnosticCodes: ReadonlySet<string> = new Set([
  ...NETWORK_ERROR_CODES,
  'account_encryption_currentness_unavailable', 'account_storage_currentness_unavailable',
  'artifact_read_unavailable', 'artifact_read_invalid', 'artifact_encryption_material_unavailable',
  'artifact_account_mode_mismatch', 'account_encryption_mode_unavailable', 'artifact_content_unavailable', 'content_unavailable',
  'unauthorized', 'forbidden', 'unsupported', 'account-mode-mismatch', 'database_transaction_conflict_exhausted',
  'scope-retired', 'catalog-unobserved', 'encryption-material-unavailable', 'invalid-stored-content',
  'unreachable', 'cancelled', 'profile_missing', 'profile_disabled', 'profile_ambiguous',
  'voice_target_binding_missing', 'voice_target_binding_invalid', 'voice_target_binding_target_is_carrier',
  'voice_target_binding_changed', 'voice_target_binding_control_retired',
]);
const diagnosticClasses: ReadonlySet<string> = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'AxiosError', 'ZodError', '$ZodError',
  'PromptStackPreparationError', 'HomeReadPreparationError', 'HomeTargetResolutionError',
  'AccountEncryptionCurrentnessUnavailableError', 'ArtifactEncryptionMaterialUnavailableError',
  'VoicePromptTargetBindingError',
]);
const diagnosticSchemaCodes: ReadonlySet<string> = new Set([
  'invalid_type', 'too_big', 'too_small', 'invalid_format', 'not_multiple_of', 'unrecognized_keys',
  'invalid_union', 'invalid_key', 'invalid_element', 'invalid_value', 'custom',
]);
const diagnosticBindingFields: ReadonlySet<string> = new Set([
  'v', 'adapterId', 'controlSessionId', 'transcriptMode', 'targetSessionId', 'targetServerId', 'updatedAt',
  'voiceConversationBindingV1',
]);

/** Private failure facts only: never pass the exception, message, stack or HTTP config to the logger. */
export function recordPromptPreparationFailure(step: PromptPreparationStep, error?: unknown, reason?: string): void {
  const project = (value: unknown) => {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    const name = record?.name;
    const code = record?.code;
    return {
      errorClass: typeof name === 'string' && diagnosticClasses.has(name) ? name : 'unclassified',
      errorCode: typeof code === 'string' && diagnosticCodes.has(code) ? code : 'unclassified',
    };
  };
  let cause = error;
  let schemaError: $ZodError | undefined;
  const seen = new Set<unknown>();
  while (cause && typeof cause === 'object' && !seen.has(cause)) {
    seen.add(cause);
    if (step === 'target.binding' && cause instanceof $ZodError) schemaError = cause;
    const next: unknown = Object.getOwnPropertyDescriptor(cause, 'cause')?.value;
    if (!next || seen.has(next)) break;
    cause = next;
  }
  const original = project(cause);
  const classification = classifyServerEndpointError(error);
  logger.infoFile('[Session] Prompt preparation failed', {
    step, ...project(error), causeClass: original.errorClass, causeCode: original.errorCode,
    kind: classification.kind,
    ...(classification.statusCode === undefined ? {} : { statusCode: classification.statusCode }),
    ...(reason && diagnosticCodes.has(reason) ? { reason } : {}),
    ...(schemaError ? { schemaIssues: schemaError.issues.map(issue => {
      const code = issue.code;
      return {
        code: diagnosticSchemaCodes.has(code) ? code : 'unclassified',
        path: issue.path.map(segment => (
          typeof segment === 'string' && diagnosticBindingFields.has(segment)
          || typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0
        ) ? segment : '[redacted]'),
      };
    }) } : {}),
  });
}
