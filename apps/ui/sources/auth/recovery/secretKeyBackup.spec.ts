import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';

import { formatSecretKeyForBackup, parseBackupSecretKey } from './secretKeyBackup';

// Recovery-key format, parse and validation semantics are owned and proven by
// packages/protocol/src/auth/recoveryKey.test.ts; this suite covers only the UI adapter.
const sequentialSecretBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
const sequentialSecretBase64 = encodeBase64(sequentialSecretBytes, 'base64url');

describe('secretKeyBackup adapter', () => {
    it('round-trips a formatted key back to its original base64url secret', () => {
        const formatted = formatSecretKeyForBackup(sequentialSecretBase64);
        const parsed = parseBackupSecretKey(formatted);
        expect(parsed).toBe(sequentialSecretBase64);
        expect(decodeBase64(parsed, 'base64url')).toEqual(sequentialSecretBytes);
    });

    it('throws clear errors for empty and wrong-length formatted input', () => {
        expect(() => parseBackupSecretKey('!!!')).toThrow('No valid characters found');
        expect(() => parseBackupSecretKey('AAAAA-BBBBB')).toThrow(/Invalid key length/);
    });
});
