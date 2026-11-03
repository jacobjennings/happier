import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { createAccountScopedCryptoMaterialSnapshotV1 } from '@happier-dev/protocol/crypto/accountScopedCipher';
import { convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1 } from '@happier-dev/protocol/account/encryptionKeyFingerprintV1';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import { resolveAccountScopedCryptoMaterialFromCredentials, resolveCurrentAccountScopedCryptoMaterialSnapshot } from './resolveAccountScopedCryptoMaterialFromCredentials';

const secret = new Uint8Array(32).fill(11);
const legacyCredentials: AuthCredentials = { token: 'test-token', secret: encodeBase64(secret, 'base64url') };
const legacySnapshot = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee', material: { type: 'legacy', secret } });
const machineKey = new Uint8Array(32).fill(12);
const publicKey = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;
const dataKeyCredentials: AuthCredentials = { token: 'test-token', encryption: {
    machineKey: encodeBase64(machineKey, 'base64'), publicKey: encodeBase64(publicKey, 'base64'),
} };
const dataKeySnapshot = createAccountScopedCryptoMaterialSnapshotV1({
    accountEncryptionMode: 'e2ee', material: { type: 'dataKey', machineKey }, dataKeyPublicKey: publicKey,
});

describe('current Account material admission', () => {
    it.each([
        { name: 'legacy', credentials: legacyCredentials, snapshot: legacySnapshot },
        { name: 'dataKey', credentials: dataKeyCredentials, snapshot: dataKeySnapshot },
    ])('admits real matching $name material and refuses a different or absent Account identity', ({ credentials, snapshot }) => {
        const contentKeyFingerprint = convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(snapshot.contentPublicKeyFingerprint);
        expect(resolveCurrentAccountScopedCryptoMaterialSnapshot({ credentials, accountCurrentness: { mode: 'e2ee', contentKeyFingerprint } })).toEqual(snapshot);
        // The raw resolver remains available for callers that already own sealing authority.
        expect(resolveAccountScopedCryptoMaterialFromCredentials(credentials)).toEqual(snapshot.material);
        const otherSnapshot = snapshot === legacySnapshot ? dataKeySnapshot : legacySnapshot;
        const otherFingerprint = convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(otherSnapshot.contentPublicKeyFingerprint);
        expect(resolveCurrentAccountScopedCryptoMaterialSnapshot({ credentials, accountCurrentness: { mode: 'e2ee', contentKeyFingerprint: otherFingerprint } })).toBeNull();
        expect(resolveCurrentAccountScopedCryptoMaterialSnapshot({ credentials, accountCurrentness: { mode: 'e2ee', contentKeyFingerprint: null } })).toBeNull();
        expect(resolveCurrentAccountScopedCryptoMaterialSnapshot({ credentials, accountCurrentness: { mode: 'plain', contentKeyFingerprint: null } })).toBeNull();
        expect(resolveCurrentAccountScopedCryptoMaterialSnapshot({ credentials, accountCurrentness: { mode: 'plain', contentKeyFingerprint } })).toBeNull();
    });

    it('refuses invalid or unavailable credential material and a mismatched data-key pair even when its private-key fingerprint matches', () => {
        const contentKeyFingerprint = convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(dataKeySnapshot.contentPublicKeyFingerprint);
        const mismatchedPair: AuthCredentials = { token: 'test-token', encryption: {
            machineKey: encodeBase64(machineKey, 'base64'),
            publicKey: encodeBase64(tweetnacl.box.keyPair.fromSecretKey(secret).publicKey, 'base64'),
        } };
        const malformed: AuthCredentials = { token: 'test-token', secret: encodeBase64(new Uint8Array(31), 'base64url') };
        for (const credentials of [mismatchedPair, malformed, { token: 'test-token' }]) {
            expect(resolveCurrentAccountScopedCryptoMaterialSnapshot({ credentials, accountCurrentness: { mode: 'e2ee', contentKeyFingerprint } })).toBeNull();
        }
    });
});
