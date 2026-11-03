import { describe, expect, it, vi } from 'vitest';

import { SecretBoxEncryption, type Decryptor, type Encryptor } from './encryptor';
import { decodeBase64 } from '@/encryption/base64';
import { EncryptionCache } from './encryptionCache';
import { SessionEncryption } from './sessionEncryption';

type Base64DecryptFn = (data: readonly string[]) => Promise<(unknown | null)[]>;

function createBase64Decryptor(
    decryptBase64: Base64DecryptFn,
): Encryptor & Decryptor & { decryptBase64: Base64DecryptFn } {
    return {
        encrypt: async () => {
            throw new Error('encrypt should not be called');
        },
        decrypt: async () => {
            throw new Error('decrypt should not be called when decryptBase64 is available');
        },
        decryptBase64,
    };
}

describe('SessionEncryption metadata in-flight dedupe', () => {
    it('distinguishes a failed Agent-state open from authenticated metadata and recovers without poisoning the cache', async () => {
        const crypto = new SecretBoxEncryption(new Uint8Array(32).fill(7));
        const wrongCrypto = new SecretBoxEncryption(new Uint8Array(32).fill(8));
        const sessionEncryption = new SessionEncryption('state-open-evidence', crypto, new EncryptionCache());
        const metadata = { path: '/repo', host: 'machine' };
        const encryptedMetadata = await sessionEncryption.encryptMetadata(metadata);
        const [wrongState] = await wrongCrypto.encrypt([{ controlledByUser: true }]);
        const encryptedState = await sessionEncryption.encryptAgentState({ controlledByUser: true });
        const decrypt = vi.spyOn(crypto, 'decrypt');

        await expect(sessionEncryption.decryptSessionSnapshotStateResult(
            1, encryptedMetadata, 2, Buffer.from(wrongState).toString('base64'),
        )).resolves.toEqual({ metadata, agentState: { status: 'unavailable' } });
        expect(decrypt).toHaveBeenCalledTimes(1);
        expect(decrypt.mock.calls[0][0]).toHaveLength(2);

        await expect(sessionEncryption.decryptSessionSnapshotStateResult(
            1, encryptedMetadata, 2, encryptedState,
        )).resolves.toEqual({ metadata, agentState: { status: 'available', value: { controlledByUser: true } } });
        expect(decrypt).toHaveBeenCalledTimes(2);
        expect(decrypt.mock.calls[1][0]).toHaveLength(1);
        await expect(sessionEncryption.decryptAgentState(2, encryptedState)).resolves.toEqual({ controlledByUser: true });
        expect(decrypt).toHaveBeenCalledTimes(2);
    });

    it('keeps authenticated empty state, explicit clears, omitted state and invalid payloads distinct', async () => {
        const crypto = new SecretBoxEncryption(new Uint8Array(32).fill(7));
        const sessionEncryption = new SessionEncryption('state-open-kinds', crypto, new EncryptionCache());
        const empty = await sessionEncryption.encryptAgentState({});
        const [invalid, encryptedNull] = await crypto.encrypt([[], null]);

        await expect(sessionEncryption.decryptAgentStateResult(1, empty)).resolves.toEqual({ status: 'available', value: {} });
        await expect(sessionEncryption.decryptAgentStateResult(2, null)).resolves.toEqual({ status: 'available', value: null });
        await expect(sessionEncryption.decryptAgentStateResult(2, undefined)).resolves.toEqual({ status: 'unavailable' });
        for (const payload of [invalid, encryptedNull]) {
            await expect(sessionEncryption.decryptAgentStateResult(3, Buffer.from(payload).toString('base64')))
                .resolves.toEqual({ status: 'unavailable' });
        }
        const metadata = { path: '/repo', host: 'machine' };
        const encryptedMetadata = await sessionEncryption.encryptMetadata(metadata);
        await expect(sessionEncryption.decryptSessionSnapshotStateResult(1, encryptedMetadata, 2, null))
            .resolves.toEqual({ metadata, agentState: { status: 'available', value: null } });
        await expect(sessionEncryption.decryptSessionSnapshotStateResult(1, encryptedMetadata, 2, undefined))
            .resolves.toEqual({ metadata, agentState: { status: 'unavailable' } });
        await expect(sessionEncryption.decryptSessionSnapshotStateResult(1, encryptedMetadata, 3, Buffer.from(invalid).toString('base64')))
            .resolves.toEqual({ metadata, agentState: { status: 'unavailable' } });
    });

    it('does not publish Agent-state open evidence from a retired Session reader', async () => {
        const crypto = new SecretBoxEncryption(new Uint8Array(32).fill(7));
        let current = true;
        const sessionEncryption = new SessionEncryption('state-open-retired', crypto, new EncryptionCache(), null, () => current);
        const encrypted = await sessionEncryption.encryptAgentState({ controlledByUser: true });
        const pending = sessionEncryption.decryptAgentStateResult(1, encrypted);
        current = false;
        await expect(pending).resolves.toEqual({ status: 'unavailable' });
        await expect(sessionEncryption.decryptAgentStateResult(1, null)).resolves.toEqual({ status: 'unavailable' });
        current = true;
        await expect(sessionEncryption.decryptAgentStateResult(1, encrypted))
            .resolves.toEqual({ status: 'available', value: { controlledByUser: true } });
    });

    it('seals a released-UI-safe flat Herdr projection and opens only the canonical host selectors', async () => {
        const metadata = {
            path: '/repo', host: 'machine', name: 'renamed',
            terminal: { mode: 'herdr', requested: 'herdr', herdr: { sessionName: 'work', socketPath: '/tmp/herdr.sock', terminalId: 'term_1' } },
            providerExtension: { retained: true },
        } as const;
        const crypto = new SecretBoxEncryption(new Uint8Array(32));
        const sessionEncryption = new SessionEncryption('session-1', crypto, new EncryptionCache());
        const encrypted = await sessionEncryption.encryptMetadata(metadata);
        const [wire] = await crypto.decrypt([decodeBase64(encrypted, 'base64')]);
        expect(wire).toMatchObject({ terminal: { mode: 'plain', hostKind: 'herdr', requested: 'plain', requestedHostKind: 'herdr' } });
        await expect(sessionEncryption.decryptMetadata(2, encrypted)).resolves.toEqual(metadata);
    });

    it('returns the exact raw metadata envelope for layout-aware strict parsing', async () => {
        const sharedMetadata = {
            v: 1,
            summary: { text: 'Safe title', updatedAt: 10 },
        };
        const decryptBase64 = vi.fn<Base64DecryptFn>(async () => [sharedMetadata]);
        const sessionEncryption = new SessionEncryption(
            'session-1',
            createBase64Decryptor(decryptBase64),
            new EncryptionCache(),
        );

        await expect(
            sessionEncryption.decryptMetadataPayload(1, 'ciphertext-layout-v1'),
        ).resolves.toEqual(sharedMetadata);
    });

    it('shares concurrent metadata decrypts for the same session version and ciphertext', async () => {
        const metadata = { path: '/repo', host: 'machine' };
        let releaseDecrypt: () => void = () => {};
        const decryptBase64 = vi.fn<Base64DecryptFn>(async () => {
            await new Promise<void>((resolve) => {
                releaseDecrypt = resolve;
            });
            return [metadata];
        });
        const sessionEncryption = new SessionEncryption(
            'session-1',
            createBase64Decryptor(decryptBase64),
            new EncryptionCache(),
        );

        const first = sessionEncryption.decryptMetadata(1, 'ciphertext-a');
        const second = sessionEncryption.decryptMetadata(1, 'ciphertext-a');

        expect(decryptBase64).toHaveBeenCalledTimes(1);
        releaseDecrypt();
        await expect(Promise.all([first, second])).resolves.toEqual([metadata, metadata]);
    });

    it('shares concurrent agent-state decrypts for the same session version and ciphertext', async () => {
        const agentState = { controlledByUser: true };
        let releaseDecrypt: () => void = () => {};
        const decryptBase64 = vi.fn<Base64DecryptFn>(async () => {
            await new Promise<void>((resolve) => {
                releaseDecrypt = resolve;
            });
            return [agentState];
        });
        const sessionEncryption = new SessionEncryption(
            'session-1',
            createBase64Decryptor(decryptBase64),
            new EncryptionCache(),
        );

        const first = sessionEncryption.decryptAgentState(2, 'ciphertext-b');
        const second = sessionEncryption.decryptAgentState(2, 'ciphertext-b');

        expect(decryptBase64).toHaveBeenCalledTimes(1);
        releaseDecrypt();
        await expect(Promise.all([first, second])).resolves.toEqual([agentState, agentState]);
    });

    it('retries metadata decrypt after an in-flight decrypt rejects', async () => {
        const metadata = { path: '/repo', host: 'machine' };
        const decryptBase64 = vi
            .fn<Base64DecryptFn>()
            .mockRejectedValueOnce(new Error('decrypt failed'))
            .mockResolvedValueOnce([metadata]);
        const sessionEncryption = new SessionEncryption(
            'session-1',
            createBase64Decryptor(decryptBase64),
            new EncryptionCache(),
        );

        const first = sessionEncryption.decryptMetadata(1, 'ciphertext-a');
        const second = sessionEncryption.decryptMetadata(1, 'ciphertext-a');

        await expect(Promise.all([first, second])).rejects.toThrow('decrypt failed');
        await expect(sessionEncryption.decryptMetadata(1, 'ciphertext-a')).resolves.toEqual(metadata);
        expect(decryptBase64).toHaveBeenCalledTimes(2);
    });

    it('shares concurrent snapshot-state decrypts for the same session versions and ciphertexts', async () => {
        const metadata = { path: '/repo', host: 'machine' };
        const agentState = { controlledByUser: true };
        let releaseDecrypt: () => void = () => {};
        const decryptBase64 = vi.fn<Base64DecryptFn>(async () => {
            await new Promise<void>((resolve) => {
                releaseDecrypt = resolve;
            });
            return [metadata, agentState];
        });
        const sessionEncryption = new SessionEncryption(
            'session-1',
            createBase64Decryptor(decryptBase64),
            new EncryptionCache(),
        );

        const first = sessionEncryption.decryptSessionSnapshotState(1, 'ciphertext-a', 2, 'ciphertext-b');
        const second = sessionEncryption.decryptSessionSnapshotState(1, 'ciphertext-a', 2, 'ciphertext-b');

        expect(decryptBase64).toHaveBeenCalledTimes(1);
        releaseDecrypt();
        await expect(Promise.all([first, second])).resolves.toEqual([
            { metadata, agentState },
            { metadata, agentState },
        ]);
    });

    it('does not share metadata decrypts across session encryption instances', async () => {
        const firstMetadata = { path: '/repo-a', host: 'machine-a' };
        const secondMetadata = { path: '/repo-b', host: 'machine-b' };
        const firstDecryptBase64 = vi.fn<Base64DecryptFn>(async () => [firstMetadata]);
        const secondDecryptBase64 = vi.fn<Base64DecryptFn>(async () => [secondMetadata]);
        const firstSessionEncryption = new SessionEncryption(
            'session-1',
            createBase64Decryptor(firstDecryptBase64),
            new EncryptionCache(),
        );
        const secondSessionEncryption = new SessionEncryption(
            'session-1',
            createBase64Decryptor(secondDecryptBase64),
            new EncryptionCache(),
        );

        await expect(Promise.all([
            firstSessionEncryption.decryptMetadata(1, 'ciphertext-a'),
            secondSessionEncryption.decryptMetadata(1, 'ciphertext-a'),
        ])).resolves.toEqual([firstMetadata, secondMetadata]);
        expect(firstDecryptBase64).toHaveBeenCalledTimes(1);
        expect(secondDecryptBase64).toHaveBeenCalledTimes(1);
    });
});
