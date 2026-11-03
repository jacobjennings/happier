import { describe, expect, it } from 'vitest';

import { buildFileLineSelectionFingerprint, canStartLineSelection, canUseLineSelection } from './scmLineSelection';

describe('canUseLineSelection', () => {
    it('allows line selection only when write operations are enabled and diff mode is explicit', () => {
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: false,
                isBinary: false,
                diffMode: 'pending',
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
            })
        ).toBe(true);
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: false,
                isBinary: false,
                diffMode: 'included',
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
            })
        ).toBe(true);
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: false,
                isBinary: false,
                diffMode: 'included',
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
                includeExcludeEnabled: false,
            })
        ).toBe(false);
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: false,
                isBinary: false,
                diffMode: 'pending',
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
                includeExcludeEnabled: false,
                virtualLineSelectionEnabled: true,
            })
        ).toBe(true);
    });

    it('blocks line selection for combined diffs, binary files, conflicts, disabled writes, or empty diff', () => {
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: false,
                isBinary: false,
                diffMode: 'both',
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
            })
        ).toBe(false);
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: false,
                isBinary: true,
                diffMode: 'pending',
                diffContent: 'binary',
            })
        ).toBe(false);
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: true,
                isBinary: false,
                diffMode: 'pending',
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
            })
        ).toBe(false);
        expect(
            canUseLineSelection({
                scmWriteEnabled: false,
                hasConflicts: false,
                isBinary: false,
                diffMode: 'pending',
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
            })
        ).toBe(false);
        expect(
            canUseLineSelection({
                scmWriteEnabled: true,
                hasConflicts: false,
                isBinary: false,
                diffMode: 'pending',
                diffContent: '',
            })
        ).toBe(false);
    });
});

describe('canStartLineSelection', () => {
    it('allows starting line selection from a combined diff when a pending delta can be line-selected', () => {
        expect(
            canStartLineSelection({
                scmWriteEnabled: true,
                includeExcludeEnabled: false,
                virtualLineSelectionEnabled: true,
                hasConflicts: false,
                isBinary: false,
                hasPendingDelta: true,
                hasIncludedDelta: true,
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
            }),
        ).toBe(true);
    });

    it('blocks starting line selection when no selectable delta or no renderable diff exists', () => {
        expect(
            canStartLineSelection({
                scmWriteEnabled: true,
                includeExcludeEnabled: false,
                virtualLineSelectionEnabled: true,
                hasConflicts: false,
                isBinary: false,
                hasPendingDelta: false,
                hasIncludedDelta: true,
                diffContent: 'diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new\n',
            }),
        ).toBe(false);
        expect(
            canStartLineSelection({
                scmWriteEnabled: true,
                includeExcludeEnabled: false,
                virtualLineSelectionEnabled: true,
                hasConflicts: false,
                isBinary: false,
                hasPendingDelta: true,
                hasIncludedDelta: false,
                diffContent: '',
            }),
        ).toBe(false);
    });
});

describe('buildFileLineSelectionFingerprint', () => {
    it('is stable for an equal copy and changes when any entry field changes', () => {
        const entry = {
            path: 'src/a.ts',
            previousPath: null as string | null,
            includeStatus: 'M',
            pendingStatus: ' ',
            hasIncludedDelta: true,
            hasPendingDelta: false,
            stats: {
                includedAdded: 2,
                includedRemoved: 1,
                pendingAdded: 0,
                pendingRemoved: 0,
                isBinary: false,
            },
        };
        const base = buildFileLineSelectionFingerprint(entry);
        expect(buildFileLineSelectionFingerprint({ ...entry, stats: { ...entry.stats } })).toBe(base);

        const variants = [
            { ...entry, path: 'src/b.ts' },
            { ...entry, previousPath: 'src/old.ts' },
            { ...entry, includeStatus: 'A' },
            { ...entry, pendingStatus: 'M' },
            { ...entry, hasIncludedDelta: false },
            { ...entry, hasPendingDelta: true },
            { ...entry, stats: { ...entry.stats, includedAdded: 3 } },
            { ...entry, stats: { ...entry.stats, includedRemoved: 2 } },
            { ...entry, stats: { ...entry.stats, pendingAdded: 3 } },
            { ...entry, stats: { ...entry.stats, pendingRemoved: 3 } },
            { ...entry, stats: { ...entry.stats, isBinary: true } },
        ];
        const fingerprints = new Set(variants.map((variant) => buildFileLineSelectionFingerprint(variant)));
        expect(fingerprints.has(base)).toBe(false);
        expect(fingerprints.size).toBe(variants.length);
    });
});
