import { describe, expect, it } from 'vitest';

import { resolveOsc52ClipboardAction } from './security';

describe('terminal interaction security policy', () => {
    it('denies OSC52 clipboard writes by default', () => {
        expect(resolveOsc52ClipboardAction()).toEqual({
            kind: 'deny',
            reason: 'osc52_denied',
        });
    });
});
