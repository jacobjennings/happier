import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { decodeBase64, encodeBase64 } from '../../crypto/base64.js';
import { openAccountScopedBlobCiphertext, sealAccountScopedBlobCiphertext } from '../../crypto/accountScopedCipher.js';
import {
  openSessionOwnerDisplayEnvelopeV1, sealSessionOwnerDisplayEnvelopeV1,
  openSessionSharedDisplayEnvelopeV1, sealSessionSharedDisplayEnvelopeV1,
  openSessionSharedDisplayEnvelopeV1Sync, sealSessionSharedDisplayEnvelopeV1Sync,
  SessionSharedDisplayV1Schema, SessionOwnerDisplayV1Schema,
} from './sessionDisplayEnvelopesV1.js';

// These callbacks are the real Session secretbox boundary, with deterministic test keys/nonces.
function sessionCipher(key: Uint8Array) {
  return {
    encryptPayload(payload: unknown): string {
      const nonce = new Uint8Array(tweetnacl.secretbox.nonceLength).fill(3);
      const box = tweetnacl.secretbox(new TextEncoder().encode(JSON.stringify(payload)), nonce, key);
      const bytes = new Uint8Array(1 + nonce.length + box.length);
      bytes.set(nonce, 1); bytes.set(box, 1 + nonce.length);
      return encodeBase64(bytes, 'base64');
    },
    decryptPayload(ciphertext: string): unknown {
      const bytes = decodeBase64(ciphertext, 'base64');
      if (bytes[0] !== 0) return null;
      const plaintext = tweetnacl.secretbox.open(bytes.slice(25), bytes.slice(1, 25), key);
      return plaintext ? JSON.parse(new TextDecoder().decode(plaintext)) : null;
    },
  };
}

describe('Session display content envelopes', () => {
  const material = { type: 'dataKey' as const, machineKey: new Uint8Array(32).fill(7) };
  const sharedKey = new Uint8Array(32).fill(8);
  const sharedDisplay = SessionSharedDisplayV1Schema.parse({ v: 1, summaryText: 'Recipient title' });
  const ownerDisplay = SessionOwnerDisplayV1Schema.parse({ v: 1, name: 'Private name', path: '/private' });
  const randomBytes = (length: number) => new Uint8Array(length).fill(4);

  it('seals both fresh-create leaves before a final Session ID exists', async () => {
    const cipher = sessionCipher(sharedKey);
    const shared = await sealSessionSharedDisplayEnvelopeV1({ sessionMode: 'e2ee', display: sharedDisplay, ...cipher });
    const owner = sealSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', display: ownerDisplay, material, randomBytes });
    expect(shared.ok && owner.ok).toBe(true);
    if (!shared.ok || !owner.ok || shared.envelope.t !== 'encrypted' || owner.envelope.t !== 'encrypted') {
      throw new Error('Expected fresh-create display ciphertexts');
    }
    expect(cipher.decryptPayload(shared.envelope.c)).toEqual({
      v: 1, audience: 'shared', purpose: 'session_shared_display', display: sharedDisplay,
    });
    expect(openAccountScopedBlobCiphertext({ kind: 'session_owner_display', material, ciphertext: owner.envelope.c })?.value).toEqual({
      v: 1, audience: 'owner', purpose: 'session_owner_display', display: ownerDisplay,
    });
    expect(await openSessionSharedDisplayEnvelopeV1({ sessionMode: 'e2ee', envelope: shared.envelope, ...cipher })).toEqual({ ok: true, display: sharedDisplay });
    expect(openSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', envelope: owner.envelope, material })).toEqual({ ok: true, display: ownerDisplay });
  });

  it('opens genuine ciphertexts only with the Session key or Account material and correct audience and purpose', async () => {
    const cipher = sessionCipher(sharedKey);
    const shared = await sealSessionSharedDisplayEnvelopeV1({ sessionMode: 'e2ee', display: sharedDisplay, ...cipher });
    const owner = sealSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', display: ownerDisplay, material, randomBytes });
    expect(shared.ok && owner.ok).toBe(true);
    if (!shared.ok || !owner.ok) throw new Error('Expected valid display ciphertexts');
    expect(await openSessionSharedDisplayEnvelopeV1({ sessionMode: 'e2ee', envelope: shared.envelope, ...cipher })).toEqual({ ok: true, display: sharedDisplay });
    expect(openSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', envelope: owner.envelope, material })).toEqual({ ok: true, display: ownerDisplay });
    expect(await openSessionSharedDisplayEnvelopeV1({ sessionMode: 'e2ee', envelope: shared.envelope, ...sessionCipher(new Uint8Array(32).fill(9)) })).toEqual({ ok: false, reason: 'invalid_ciphertext' });
    expect(await openSessionSharedDisplayEnvelopeV1({ sessionMode: 'e2ee', envelope: owner.envelope, ...cipher })).toEqual({ ok: false, reason: 'invalid_envelope' });
    expect(openSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', envelope: shared.envelope, material })).toEqual({ ok: false, reason: 'invalid_envelope' });
    expect(openSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', envelope: owner.envelope, material: { type: 'dataKey', machineKey: sharedKey } })).toEqual({ ok: false, reason: 'invalid_ciphertext' });
    if (owner.envelope.t !== 'encrypted') throw new Error('Expected Account ciphertext');
    expect(openAccountScopedBlobCiphertext({ kind: 'session_owner_metadata', material, ciphertext: owner.envelope.c })).toBeNull();
    const wrongPurpose = sealAccountScopedBlobCiphertext({ kind: 'session_owner_display', material, randomBytes,
      payload: { v: 1, audience: 'shared', purpose: 'session_shared_display', display: ownerDisplay } });
    expect(openSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', envelope: { t: 'encrypted', c: wrongPurpose }, material })).toEqual({ ok: false, reason: 'invalid_envelope' });
    const wrongSharedPurpose = cipher.encryptPayload({ v: 1, audience: 'owner', purpose: 'session_owner_display', display: sharedDisplay });
    expect(await openSessionSharedDisplayEnvelopeV1({ sessionMode: 'e2ee', envelope: { t: 'encrypted', c: wrongSharedPurpose }, ...cipher })).toEqual({ ok: false, reason: 'invalid_envelope' });
  });

  it('keeps Account mode independent of plain Session mode and never needs a key for plain Account content', () => {
    const shared = sealSessionSharedDisplayEnvelopeV1Sync({ sessionMode: 'plain', display: sharedDisplay });
    const encryptedOwner = sealSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', display: ownerDisplay, material, randomBytes });
    const plainOwner = sealSessionOwnerDisplayEnvelopeV1({ accountMode: 'plain', display: ownerDisplay });
    expect(shared.ok && encryptedOwner.ok && plainOwner.ok).toBe(true);
    if (!shared.ok || !encryptedOwner.ok || !plainOwner.ok) throw new Error('Expected valid independent envelopes');
    expect(shared.envelope.t).toBe('plain');
    expect(encryptedOwner.envelope.t).toBe('encrypted');
    expect(openSessionOwnerDisplayEnvelopeV1({ accountMode: 'plain', envelope: plainOwner.envelope })).toEqual({ ok: true, display: ownerDisplay });
    expect(openSessionOwnerDisplayEnvelopeV1({ accountMode: 'e2ee', envelope: plainOwner.envelope, material })).toEqual({ ok: false, reason: 'account_mode_mismatch' });
    expect(openSessionSharedDisplayEnvelopeV1Sync({ sessionMode: 'e2ee', envelope: shared.envelope })).toEqual({ ok: false, reason: 'session_mode_mismatch' });
    const encryptedShared = sealSessionSharedDisplayEnvelopeV1Sync({ sessionMode: 'e2ee', display: sharedDisplay, ...sessionCipher(sharedKey) });
    expect(encryptedShared.ok && encryptedShared.envelope.t).toBe('encrypted');
    expect(openSessionSharedDisplayEnvelopeV1Sync({ sessionMode: 'plain', envelope: shared.envelope })).toEqual({ ok: true, display: sharedDisplay });
  });
});
