import { describe, expect, it } from 'vitest';

import { parseMarkdownEditorCommandEnvelopePayload } from '../tiptapWebViewEntry';

describe('parseMarkdownEditorCommandEnvelopePayload', () => {
    it('reconstructs typed markdown commands from command-envelope payloads', () => {
        expect(parseMarkdownEditorCommandEnvelopePayload({ name: 'setHeading', args: { level: 2 } })).toEqual({
            kind: 'setHeading',
            level: 2,
        });
        expect(parseMarkdownEditorCommandEnvelopePayload({ name: 'setLink', args: { href: 'https://example.com' } })).toEqual({
            kind: 'setLink',
            href: 'https://example.com',
        });
    });

    it('rejects invalid command payloads instead of casting them', () => {
        expect(parseMarkdownEditorCommandEnvelopePayload({ name: 'heading1', args: {} })).toBeNull();
        expect(parseMarkdownEditorCommandEnvelopePayload({ name: 'setHeading', args: { level: 99 } })).toBeNull();
        expect(parseMarkdownEditorCommandEnvelopePayload({ name: 'setLink', args: { href: 123 } })).toBeNull();
        expect(parseMarkdownEditorCommandEnvelopePayload({ name: 'toggleBold', args: { extra: 'ignored' } })).toEqual({ kind: 'toggleBold' });
    });
});
