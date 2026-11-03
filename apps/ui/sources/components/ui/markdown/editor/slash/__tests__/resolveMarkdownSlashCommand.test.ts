import { describe, expect, it } from 'vitest';

import { resolveMarkdownSlashCommand } from '../resolveMarkdownSlashCommand';

describe('resolveMarkdownSlashCommand', () => {
    it.each([
        ['heading1', { kind: 'setHeading', level: 1 }],
        ['heading2', { kind: 'setHeading', level: 2 }],
        ['heading3', { kind: 'setHeading', level: 3 }],
        ['bulletList', { kind: 'toggleBulletList' }],
        ['orderedList', { kind: 'toggleOrderedList' }],
        ['taskList', { kind: 'toggleTaskList' }],
        ['blockquote', { kind: 'toggleBlockquote' }],
        ['codeBlock', { kind: 'toggleCodeBlock' }],
        ['horizontalRule', { kind: 'setHorizontalRule' }],
    ])('maps %s to its editor command', (id, command) => {
        expect(resolveMarkdownSlashCommand(id)).toEqual(command);
    });

    it('returns null for unknown command id', () => {
        expect(resolveMarkdownSlashCommand('unknownCommand')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(resolveMarkdownSlashCommand('')).toBeNull();
    });

    it('does not map link (deferred per D50)', () => {
        expect(resolveMarkdownSlashCommand('link')).toBeNull();
    });
});
