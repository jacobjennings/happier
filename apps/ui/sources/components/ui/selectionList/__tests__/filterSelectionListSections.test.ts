import { describe, expect, it } from 'vitest';

import { filterSelectionListSections } from '../filterSelectionListSections';
import type { SelectionListSectionDescriptor } from '../_types';

type StaticDescriptor = SelectionListSectionDescriptor & { kind: 'static' };
function asStatic(s: SelectionListSectionDescriptor): StaticDescriptor {
    if (s.kind !== 'static') throw new Error(`expected static section, got ${s.kind}`);
    return s;
}

function makeSection(id: string, options: ReadonlyArray<{ id: string; label: string; subtitle?: string }>): SelectionListSectionDescriptor {
    return {
        kind: 'static',
        id,
        title: id.toUpperCase(),
        options,
    };
}

const sections: ReadonlyArray<SelectionListSectionDescriptor> = [
    makeSection('quick', [
        { id: 'use-current', label: 'Use current directory', subtitle: 'Skips creating a worktree' },
        { id: 'new-worktree', label: 'Create new worktree from…' },
    ]),
    makeSection('existing', [
        { id: 'wt-1', label: 'feature/login', subtitle: '~/projects/lantern' },
        { id: 'wt-2', label: 'main', subtitle: '~/projects/lantern' },
    ]),
];

describe('filterSelectionListSections', () => {
    it.each([
        { query: '', label: 'empty' },
        { query: '   ', label: 'whitespace only' },
    ])('returns the input untouched when the query is $label', ({ query }) => {
        const out = filterSelectionListSections(sections, query);
        expect(out).toBe(sections);
    });

    it('matches case-insensitively against option labels', () => {
        const out = filterSelectionListSections(sections, 'CURRENT');
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('quick');
        expect(asStatic(out[0]).options.map((o) => o.id)).toEqual(['use-current']);
    });

    it('matches against option subtitles too', () => {
        const out = filterSelectionListSections(sections, 'lantern');
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('existing');
        expect(asStatic(out[0]).options).toHaveLength(2);
    });

    it.each([
        { query: 'feature', sectionIds: ['existing'], optionIds: [['wt-1']] },
        // Matches across both sections: the original section order is kept.
        { query: 'e', sectionIds: ['quick', 'existing'], optionIds: [['new-worktree', 'use-current'], ['wt-1', 'wt-2']] },
        { query: 'zzz-nope', sectionIds: [], optionIds: [] },
    ])('drops sections without a matching option and keeps section order for "$query"', ({ query, sectionIds, optionIds }) => {
        const out = filterSelectionListSections(sections, query);
        expect(out.map((s) => s.id)).toEqual(sectionIds);
        // Option order inside a section is the ranker's decision; this owner decides membership.
        expect(out.map((s) => asStatic(s).options.map((o) => o.id).sort())).toEqual(optionIds);
    });

    it('does not mutate the input sections or their options', () => {
        const before = structuredClone(sections);
        filterSelectionListSections(sections, 'current');
        filterSelectionListSections(sections, 'e');
        expect(sections).toEqual(before);
    });
});
