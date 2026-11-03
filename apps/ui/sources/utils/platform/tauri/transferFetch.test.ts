import { describe, expect, it } from 'vitest';

import { shouldUseTauriRuntimeFetch } from './transferFetch';

// The resolve/load/fallback paths are proven through the real owner chain in
// system/runtimeFetch.test.ts (real desktopHost over the bridge global).
describe('transferFetch', () => {
    it('uses the Tauri runtime fetch only for absolute http/https request targets', () => {
        expect(shouldUseTauriRuntimeFetch('http://127.0.0.1:43123/machine-transfers/direct/exports/x')).toBe(true);
        expect(shouldUseTauriRuntimeFetch('https://machine.example.ts.net/__happier/transfer')).toBe(true);
        expect(shouldUseTauriRuntimeFetch(new URL('https://api.example.test/v1/features'))).toBe(true);
        expect(shouldUseTauriRuntimeFetch(new Request('http://localhost:3000/transfer'))).toBe(true);

        expect(shouldUseTauriRuntimeFetch('/v1/features')).toBe(false);
        expect(shouldUseTauriRuntimeFetch('file:///tmp/happier-transfer.bin')).toBe(false);
        expect(shouldUseTauriRuntimeFetch('')).toBe(false);
        expect(shouldUseTauriRuntimeFetch('not-a-url')).toBe(false);
    });
});
