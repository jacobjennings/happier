import { describe, expect, it } from 'vitest';

import { normalizeSecretStringPromptInput } from './normalizeSecretStringPromptInput';

describe('normalizeSecretStringPromptInput', () => {
    it('returns null for null and for cleared (empty) input', () => {
        expect(normalizeSecretStringPromptInput(null)).toBeNull();
        expect(normalizeSecretStringPromptInput('')).toBeNull();
    });

    it('preserves whitespace-only input as a sealed secret value', () => {
        expect(normalizeSecretStringPromptInput('   ')).toEqual({
            _isSecretValue: true,
            value: '   ',
        });
        expect(normalizeSecretStringPromptInput('\n\t')).toEqual({ _isSecretValue: true, value: '\n\t' });
    });

    it('wraps the exact non-empty input as a sealed secret value', () => {
        expect(normalizeSecretStringPromptInput('  sk-123  ')).toEqual({
            _isSecretValue: true,
            value: '  sk-123  ',
        });
        expect(normalizeSecretStringPromptInput('\u2003key\tvalue\u2003')).toEqual({
            _isSecretValue: true,
            value: '\u2003key\tvalue\u2003',
        });
    });
});
