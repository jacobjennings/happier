import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveModelPackManifestUrl } from '@/voice/modelPacks/manifests';

describe('modelPacks manifests', () => {
  it('uses static process.env access so Expo can inline EXPO_PUBLIC_* vars', () => {
    const source = fs.readFileSync(new URL('./manifests.ts', import.meta.url), 'utf8');
    expect(source).toContain('process.env.EXPO_PUBLIC_HAPPIER_MODEL_PACK_MANIFESTS');
    expect(source).toContain('@happier-dev/voice-modelpacks');
  });

  it('resolves from the new per-pack manifest map when present', () => {
    expect(
      resolveModelPackManifestUrl({
        packId: 'kokoro-82m-v1.0-onnx-q8-wasm',
        env: {
          EXPO_PUBLIC_HAPPIER_MODEL_PACK_MANIFESTS: JSON.stringify({
            'kokoro-82m-v1.0-onnx-q8-wasm': 'https://example.com/manifest.json',
          }),
        },
      }),
    ).toBe('https://example.com/manifest.json');
  });
});
