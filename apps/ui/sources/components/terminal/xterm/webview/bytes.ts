import { encodeBase64 } from '@/encryption/base64';

export function encodeTerminalBytesBase64(bytes: Uint8Array): string {
    return encodeBase64(bytes, 'base64');
}
