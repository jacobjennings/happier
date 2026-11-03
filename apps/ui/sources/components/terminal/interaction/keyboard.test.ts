import { describe, expect, it } from 'vitest';

import { shouldTerminalCaptureKeyboardEvent } from './keyboard';

describe('shouldTerminalCaptureKeyboardEvent', () => {
    it('leaves global copy shortcuts to host copy handling', () => {
        expect(shouldTerminalCaptureKeyboardEvent({
            key: 'c',
            modifiers: ['ctrl'],
        })).toBe(false);
        expect(shouldTerminalCaptureKeyboardEvent({
            key: 'C',
            modifiers: ['meta'],
        })).toBe(false);
    });
});
