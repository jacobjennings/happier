import { beforeAll, describe, expect, it } from 'vitest';

import { buildMarkdownSlashCommands, type MarkdownSlashTranslate } from '../buildMarkdownSlashCommands';
import type { CommandMenuItem } from '@/components/ui/commandMenu/commandMenuTypes';

/**
 * Stub `t` that returns the key itself (sufficient to prove the builder calls
 * `t(...)` with the right keys; real i18n correctness is validated by the
 * existing locale-lint tooling).
 */
const stubT: MarkdownSlashTranslate = (key) => {
    return key;
};

describe('buildMarkdownSlashCommands', () => {
    let items: readonly CommandMenuItem[];

    beforeAll(() => {
        items = buildMarkdownSlashCommands(stubT);
    });

    it('returns the 9 Phase-1 commands in menu order, without link (D50)', () => {
        expect(items.map((item) => item.id)).toEqual([
            'heading1',
            'heading2',
            'heading3',
            'bulletList',
            'orderedList',
            'taskList',
            'blockquote',
            'codeBlock',
            'horizontalRule',
        ]);
    });

    it('uses t(...) for the label, description and group (stubT returns the key)', () => {
        const heading1 = items.find((i) => i.id === 'heading1')!;
        expect(heading1.label).toBe('markdown.slash.heading1.label');
        expect(heading1.description).toBe('markdown.slash.heading1.description');
        expect(heading1.group).toBe('markdown.slash.groups.headings');
    });

    it.each([
        ['heading1', 'h1'],
        ['heading1', 'title'],
        ['bulletList', 'ul'],
        ['bulletList', 'unordered'],
        ['blockquote', 'quote'],
        ['orderedList', 'ol'],
        ['orderedList', 'numbered'],
        ['taskList', 'todo'],
        ['taskList', 'checkbox'],
        ['codeBlock', 'code'],
        ['codeBlock', 'pre'],
        ['horizontalRule', 'hr'],
        ['horizontalRule', 'rule'],
    ])('%s has the %s alias', (id, alias) => {
        expect(items.find((i) => i.id === id)!.aliases).toContain(alias);
    });

    it('groups headings, lists and blocks under their group keys', () => {
        expect(Object.fromEntries(items.map((item) => [item.id, item.group]))).toEqual({
            heading1: 'markdown.slash.groups.headings',
            heading2: 'markdown.slash.groups.headings',
            heading3: 'markdown.slash.groups.headings',
            bulletList: 'markdown.slash.groups.lists',
            orderedList: 'markdown.slash.groups.lists',
            taskList: 'markdown.slash.groups.lists',
            blockquote: 'markdown.slash.groups.blocks',
            codeBlock: 'markdown.slash.groups.blocks',
            horizontalRule: 'markdown.slash.groups.blocks',
        });
    });
});
