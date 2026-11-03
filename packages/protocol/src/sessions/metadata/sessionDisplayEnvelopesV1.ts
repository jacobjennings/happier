import { openAccountScopedBlobCiphertext, sealAccountScopedBlobCiphertext, type AccountScopedCryptoMaterial } from '../../crypto/accountScopedCipher.js';
import {
  SESSION_OWNER_DISPLAY_ACCOUNT_SCOPED_KIND,
  SessionOwnerDisplayEnvelopeV1Schema, SessionOwnerDisplayPayloadV1Schema,
  SessionSharedDisplayEnvelopeV1Schema, SessionSharedDisplayPayloadV1Schema,
  type SessionOwnerDisplayV1, type SessionSharedDisplayV1,
  type SessionOwnerDisplayEnvelopeV1, type SessionSharedDisplayEnvelopeV1,
  type SessionSharedDisplayPayloadV1, type SessionDisplayFailureV1,
} from './sessionDisplaySchemasV1.js';

export * from './sessionDisplayProjectionV1.js';

export type OpenSessionSharedDisplayEnvelopeV1Result = Readonly<{ ok: true; display: SessionSharedDisplayV1 }> | SessionDisplayFailureV1;
export type OpenSessionOwnerDisplayEnvelopeV1Result = Readonly<{ ok: true; display: SessionOwnerDisplayV1 }> | SessionDisplayFailureV1;
export type SealSessionSharedDisplayEnvelopeV1Result = Readonly<{ ok: true; envelope: SessionSharedDisplayEnvelopeV1 }> | SessionDisplayFailureV1;
export type SealSessionOwnerDisplayEnvelopeV1Result = Readonly<{ ok: true; envelope: SessionOwnerDisplayEnvelopeV1 }> | SessionDisplayFailureV1;

/** Leaves precede final Session identity; no tuple revision belongs in a reusable leaf. */
export function createSessionSharedDisplayPayloadV1(params: Readonly<{
  display: SessionSharedDisplayV1;
}>): SessionSharedDisplayPayloadV1 {
  return SessionSharedDisplayPayloadV1Schema.parse({
    v: 1, audience: 'shared', purpose: 'session_shared_display', display: params.display,
  });
}

export function openSessionSharedDisplayPayloadV1(params: Readonly<{
  payload: unknown;
}>): OpenSessionSharedDisplayEnvelopeV1Result {
  const parsed = SessionSharedDisplayPayloadV1Schema.safeParse(params.payload);
  if (!parsed.success) return { ok: false, reason: 'invalid_envelope' };
  return { ok: true, display: parsed.data.display };
}

function sharedEnvelopeAdmission(params: Readonly<{
  sessionMode: 'plain' | 'e2ee'; envelope: unknown;
}>): Readonly<{ ok: true; envelope: SessionSharedDisplayEnvelopeV1 }> | SessionDisplayFailureV1 {
  const parsed = SessionSharedDisplayEnvelopeV1Schema.safeParse(params.envelope);
  if (!parsed.success) return { ok: false, reason: 'invalid_envelope' };
  return parsed.data.t === (params.sessionMode === 'plain' ? 'plain' : 'encrypted')
    ? { ok: true, envelope: parsed.data }
    : { ok: false, reason: 'session_mode_mismatch' };
}

function sealedSharedCiphertext(ciphertext: string): SealSessionSharedDisplayEnvelopeV1Result {
  const parsed = SessionSharedDisplayEnvelopeV1Schema.safeParse({ t: 'encrypted', c: ciphertext });
  return parsed.success ? { ok: true, envelope: parsed.data } : { ok: false, reason: 'invalid_ciphertext' };
}

export function sealSessionSharedDisplayEnvelopeV1Sync(params: Readonly<{
  sessionMode: 'plain' | 'e2ee'; display: SessionSharedDisplayV1;
  encryptPayload?: (payload: SessionSharedDisplayPayloadV1) => string;
}>): SealSessionSharedDisplayEnvelopeV1Result {
  const payload = createSessionSharedDisplayPayloadV1(params);
  if (params.sessionMode === 'plain') return { ok: true, envelope: { t: 'plain', v: payload } };
  if (!params.encryptPayload) return { ok: false, reason: 'crypto_unavailable' };
  try { return sealedSharedCiphertext(params.encryptPayload(payload)); }
  catch { return { ok: false, reason: 'invalid_ciphertext' }; }
}

export async function sealSessionSharedDisplayEnvelopeV1(params: Readonly<{
  sessionMode: 'plain' | 'e2ee'; display: SessionSharedDisplayV1;
  encryptPayload?: (payload: SessionSharedDisplayPayloadV1) => string | Promise<string>;
}>): Promise<SealSessionSharedDisplayEnvelopeV1Result> {
  const payload = createSessionSharedDisplayPayloadV1(params);
  if (params.sessionMode === 'plain') return { ok: true, envelope: { t: 'plain', v: payload } };
  if (!params.encryptPayload) return { ok: false, reason: 'crypto_unavailable' };
  try { return sealedSharedCiphertext(await params.encryptPayload(payload)); }
  catch { return { ok: false, reason: 'invalid_ciphertext' }; }
}

export function openSessionSharedDisplayEnvelopeV1Sync(params: Readonly<{
  sessionMode: 'plain' | 'e2ee'; envelope: unknown;
  decryptPayload?: (ciphertext: string) => unknown;
}>): OpenSessionSharedDisplayEnvelopeV1Result {
  const admitted = sharedEnvelopeAdmission(params);
  if (!admitted.ok) return admitted;
  if (admitted.envelope.t === 'plain') return openSessionSharedDisplayPayloadV1({ ...params, payload: admitted.envelope.v });
  if (!params.decryptPayload) return { ok: false, reason: 'crypto_unavailable' };
  try {
    const payload = params.decryptPayload(admitted.envelope.c);
    if (payload === null || payload === undefined) return { ok: false, reason: 'invalid_ciphertext' };
    return openSessionSharedDisplayPayloadV1({ ...params, payload });
  } catch { return { ok: false, reason: 'invalid_ciphertext' }; }
}

export async function openSessionSharedDisplayEnvelopeV1(params: Readonly<{
  sessionMode: 'plain' | 'e2ee'; envelope: unknown;
  decryptPayload?: (ciphertext: string) => unknown | Promise<unknown>;
}>): Promise<OpenSessionSharedDisplayEnvelopeV1Result> {
  const admitted = sharedEnvelopeAdmission(params);
  if (!admitted.ok) return admitted;
  if (admitted.envelope.t === 'plain') return openSessionSharedDisplayPayloadV1({ ...params, payload: admitted.envelope.v });
  if (!params.decryptPayload) return { ok: false, reason: 'crypto_unavailable' };
  try {
    const payload = await params.decryptPayload(admitted.envelope.c);
    if (payload === null || payload === undefined) return { ok: false, reason: 'invalid_ciphertext' };
    return openSessionSharedDisplayPayloadV1({ ...params, payload });
  } catch { return { ok: false, reason: 'invalid_ciphertext' }; }
}

export function sealSessionOwnerDisplayEnvelopeV1(params: Readonly<{
  accountMode: 'plain' | 'e2ee'; display: SessionOwnerDisplayV1;
  material?: AccountScopedCryptoMaterial | null; randomBytes?: (length: number) => Uint8Array;
}>): SealSessionOwnerDisplayEnvelopeV1Result {
  const payload = SessionOwnerDisplayPayloadV1Schema.parse({
    v: 1, audience: 'owner', purpose: 'session_owner_display', display: params.display,
  });
  if (params.accountMode === 'plain') return { ok: true, envelope: { t: 'plain', v: payload } };
  if (!params.material) return { ok: false, reason: 'material_unavailable' };
  if (!params.randomBytes) return { ok: false, reason: 'crypto_unavailable' };
  try {
    return { ok: true, envelope: { t: 'encrypted', c: sealAccountScopedBlobCiphertext({
      kind: SESSION_OWNER_DISPLAY_ACCOUNT_SCOPED_KIND, payload, material: params.material, randomBytes: params.randomBytes,
    }) } };
  } catch { return { ok: false, reason: 'invalid_ciphertext' }; }
}

export function openSessionOwnerDisplayEnvelopeV1(params: Readonly<{
  accountMode: 'plain' | 'e2ee'; envelope: unknown;
  material?: AccountScopedCryptoMaterial | null;
}>): OpenSessionOwnerDisplayEnvelopeV1Result {
  const parsed = SessionOwnerDisplayEnvelopeV1Schema.safeParse(params.envelope);
  if (!parsed.success) return { ok: false, reason: 'invalid_envelope' };
  const envelope = parsed.data;
  if (envelope.t !== (params.accountMode === 'plain' ? 'plain' : 'encrypted')) return { ok: false, reason: 'account_mode_mismatch' };
  let payload: unknown;
  if (envelope.t === 'plain') payload = envelope.v;
  else {
    if (!params.material) return { ok: false, reason: 'material_unavailable' };
    const opened = openAccountScopedBlobCiphertext({
      kind: SESSION_OWNER_DISPLAY_ACCOUNT_SCOPED_KIND, material: params.material, ciphertext: envelope.c,
    });
    if (!opened || opened.format !== 'account_scoped_v1' || opened.kindTag !== 'canonical') return { ok: false, reason: 'invalid_ciphertext' };
    payload = opened.value;
  }
  const bound = SessionOwnerDisplayPayloadV1Schema.safeParse(payload);
  if (!bound.success) return { ok: false, reason: 'invalid_envelope' };
  return { ok: true, display: bound.data.display };
}
