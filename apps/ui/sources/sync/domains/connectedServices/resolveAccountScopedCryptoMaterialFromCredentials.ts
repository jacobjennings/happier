import type { AccountScopedCryptoMaterial } from '@happier-dev/protocol';
import { createAccountScopedCryptoMaterialSnapshotV1, type AccountScopedCryptoMaterialSnapshotV1 } from '@happier-dev/protocol/crypto/accountScopedCipher';
import { convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1 } from '@happier-dev/protocol/account/encryptionKeyFingerprintV1';
import type { AccountEncryptionIdentity } from '@happier-dev/sync-client';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { isDataKeyAuthCredentials, isLegacyAuthCredentials } from '@/auth/storage/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';

function assert32Bytes(label: string, bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 32) {
    throw new Error(`Invalid ${label} length: ${bytes.length} (expected 32)`);
  }
  return bytes;
}

export function resolveAccountScopedCryptoMaterialFromCredentials(
  credentials: AuthCredentials,
): AccountScopedCryptoMaterial {
  if (isLegacyAuthCredentials(credentials)) {
    return {
        type: 'legacy',
        secret: assert32Bytes('recovery secret', decodeBase64(credentials.secret, 'base64url')),
      };
  }
  if (isDataKeyAuthCredentials(credentials)) {
    return {
        type: 'dataKey',
        machineKey: assert32Bytes('machine key', decodeBase64(credentials.encryption.machineKey, 'base64')),
      };
  }
  throw new Error('Account encryption material is unavailable for token-only credentials');
}

/** Opening Account content requires material proved against the current Account identity. */
export function resolveCurrentAccountScopedCryptoMaterialSnapshot(params: Readonly<{
  credentials: AuthCredentials;
  accountCurrentness: Pick<AccountEncryptionIdentity, 'mode' | 'contentKeyFingerprint'>;
}>): AccountScopedCryptoMaterialSnapshotV1 | null {
  if (params.accountCurrentness.mode !== 'e2ee' || !params.accountCurrentness.contentKeyFingerprint) return null;
  try {
    const snapshot = createAccountScopedCryptoMaterialSnapshotV1({
      accountEncryptionMode: 'e2ee',
      material: resolveAccountScopedCryptoMaterialFromCredentials(params.credentials),
      ...(isDataKeyAuthCredentials(params.credentials) ? {
        dataKeyPublicKey: decodeBase64(params.credentials.encryption.publicKey, 'base64'),
      } : {}),
    });
    return convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(
      snapshot.contentPublicKeyFingerprint,
    ) === params.accountCurrentness.contentKeyFingerprint ? snapshot : null;
  } catch {
    // Malformed credentials and mismatched public/private keys cannot authorize an open.
    return null;
  }
}
