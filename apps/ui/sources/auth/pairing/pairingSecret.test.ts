import { describe, expect, it, vi } from 'vitest';

const randomBytesMock = vi.hoisted(() => vi.fn(() => new Uint8Array(32).fill(7)));

vi.mock('@/platform/cryptoRandom', () => ({
    getRandomBytes: randomBytesMock,
}));

import { createPairingSecret } from './pairingSecret';

describe('createPairingSecret', () => {
    it('creates V2 QR secret material from 32 random bytes as base64url', async () => {
        await expect(createPairingSecret()).resolves.toEqual({
            secret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
        });
        expect(randomBytesMock).toHaveBeenCalledWith(32);
    });
});
