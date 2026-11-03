import { describe, expect, it } from 'vitest';

import {
    observePrependOutcome,
    type PrependCapturedAnchor,
    type PrependPostCommitObservation,
} from '@/components/sessions/transcript/viewport/prepend/observePrependOutcome';

type Item = Readonly<{ id: string; kind: 'message'; messageId: string }>;

function messageItem(messageId: string): Item {
    return { id: `msg:${messageId}`, kind: 'message', messageId };
}

function capturedAnchor(overrides?: Partial<PrependCapturedAnchor>): PrependCapturedAnchor {
    return {
        key: { itemId: 'msg:m3', messageId: 'm3' },
        itemOffsetPx: 80,
        capturedDataLength: 3,
        capturedFirstItemId: 'msg:m3',
        ...overrides,
    };
}

function postCommit(params: Readonly<{
    items: readonly Item[];
    layoutYByIndex: Readonly<Record<number, number>>;
    absoluteScrollOffset: number;
    contentHeight: number;
    layoutHeight: number;
}>): PrependPostCommitObservation {
    return {
        items: params.items,
        getLayout: (index) => {
            const y = params.layoutYByIndex[index];
            return typeof y === 'number' ? { y } : undefined;
        },
        absoluteScrollOffset: params.absoluteScrollOffset,
        contentHeight: params.contentHeight,
        layoutHeight: params.layoutHeight,
    };
}

describe('observePrependOutcome', () => {
    it('classifies identity-unchanged when no prepend landed (same length, same first item id)', () => {
        const items = [messageItem('m3'), messageItem('m4'), messageItem('m5')];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 200, 2: 400 },
                absoluteScrollOffset: 0,
                contentHeight: 600,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'identity-unchanged' });
    });

    it('classifies identity-unchanged when items shrank but the first item id is unchanged', () => {
        const items = [messageItem('m3'), messageItem('m4')];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 200 },
                absoluteScrollOffset: 0,
                contentHeight: 400,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'identity-unchanged' });
    });

    it('treats the default 4px alignment tolerance as preserved and one px beyond as fallback', () => {
        const items = [messageItem('m1'), messageItem('m3')];
        const anchor = capturedAnchor({ capturedDataLength: 1, capturedFirstItemId: 'msg:m3' });
        const observationAtScrollOffset = (absoluteScrollOffset: number) => postCommit({
            items,
            layoutYByIndex: { 0: 0, 1: 500 },
            absoluteScrollOffset,
            contentHeight: 1000,
            layoutHeight: 300,
        });

        // observed = 500 - 416 = 84 → delta = +4 = default tolerance → preserved.
        expect(observePrependOutcome({ capturedAnchor: anchor, postCommit: observationAtScrollOffset(416) }))
            .toEqual({ kind: 'mvcp-preserved', observedItemOffsetPx: 84, deltaPx: 4 });
        // observed = 500 - 415 = 85 → delta = +5 → one corrective write back to 500 - 80.
        expect(observePrependOutcome({ capturedAnchor: anchor, postCommit: observationAtScrollOffset(415) }))
            .toMatchObject({ kind: 'needs-fallback', targetOffsetY: 420 });
    });

    it('clamps the fallback offset to the maximum scrollable offset', () => {
        // target raw = 1450 - 80 = 1370 but max = 1500 - 300 = 1200.
        const items = [messageItem('m1'), messageItem('m3')];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor({ capturedDataLength: 1, capturedFirstItemId: 'msg:m3' }),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 1450 },
                absoluteScrollOffset: 0,
                contentHeight: 1500,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toMatchObject({ kind: 'needs-fallback', targetOffsetY: 1200 });
    });

    it('resolves the anchor by messageId when the item id changed across re-grouping', () => {
        // Prepend re-grouping can re-id the containing item; messageId containment must still resolve.
        const items = [
            messageItem('m1'),
            { id: 'msg:renamed', kind: 'message', messageId: 'm3' } satisfies Item,
        ];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor({ capturedDataLength: 1, capturedFirstItemId: 'msg:m3' }),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 500 },
                absoluteScrollOffset: 420,
                contentHeight: 1000,
                layoutHeight: 300,
            }),
        });
        expect(outcome.kind).toBe('mvcp-preserved');
    });

    it('proceeds to anchor resolution when length is unchanged but the first item id changed (headless-turn merge)', () => {
        // C3 merge shape: a prepend absorbed into the headless first turn keeps the item count but
        // re-ids the first item. This must NOT read as identity-unchanged; messageId containment
        // still resolves the anchor.
        const items = [
            { id: 'turn:merged', kind: 'message', messageId: 'm3' } satisfies Item,
            messageItem('m4'),
            messageItem('m5'),
        ];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items,
                // observed = 100 - 20 = 80 = captured offset → preserved.
                layoutYByIndex: { 0: 100, 1: 400, 2: 600 },
                absoluteScrollOffset: 20,
                contentHeight: 900,
                layoutHeight: 300,
            }),
        });
        expect(outcome.kind).toBe('mvcp-preserved');
    });

    it('classifies anchor-missing for empty committed items instead of identity-unchanged', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items: [],
                layoutYByIndex: {},
                absoluteScrollOffset: 0,
                contentHeight: 0,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'anchor-missing' });
    });

    it('classifies identity-unchanged when both the capture and the observation have no items', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor({ capturedDataLength: 0, capturedFirstItemId: null }),
            postCommit: postCommit({
                items: [],
                layoutYByIndex: {},
                absoluteScrollOffset: 0,
                contentHeight: 0,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'identity-unchanged' });
    });

    it('classifies anchor-missing when neither the message nor the item id survives', () => {
        const items = [messageItem('m1'), messageItem('m2')];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor({ capturedDataLength: 1, capturedFirstItemId: 'msg:m9' }),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 500 },
                absoluteScrollOffset: 0,
                contentHeight: 1000,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'anchor-missing' });
    });

    it('classifies layout-not-ready when the anchor item has no measured layout yet', () => {
        const items = [messageItem('m1'), messageItem('m3')];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor({ capturedDataLength: 1, capturedFirstItemId: 'msg:m3' }),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0 },
                absoluteScrollOffset: 0,
                contentHeight: 1000,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'layout-not-ready' });
    });

    it('classifies layout-not-ready when the absolute scroll offset is not finite', () => {
        const items = [messageItem('m1'), messageItem('m3')];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor({ capturedDataLength: 1, capturedFirstItemId: 'msg:m3' }),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 500 },
                absoluteScrollOffset: Number.NaN,
                contentHeight: 1000,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'layout-not-ready' });
    });

    it('classifies layout-not-ready when a misaligned anchor cannot produce a valid corrective offset', () => {
        // Misaligned but content does not scroll (contentHeight <= layoutHeight) → no valid write target.
        const items = [messageItem('m1'), messageItem('m3')];
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor({ capturedDataLength: 1, capturedFirstItemId: 'msg:m3' }),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 150 },
                absoluteScrollOffset: 0,
                contentHeight: 250,
                layoutHeight: 300,
            }),
        });
        expect(outcome).toEqual({ kind: 'unresolvable', reason: 'layout-not-ready' });
    });
});

describe('observePrependOutcome corrector deference (N2d.1)', () => {
    const items = [messageItem('m1'), messageItem('m2'), messageItem('m3'), messageItem('m4'), messageItem('m5')];
    const staleObservation = postCommit({
        items,
        layoutYByIndex: { 0: 0, 1: 450, 2: 900, 3: 1100, 4: 1300 },
        absoluteScrollOffset: 0,
        contentHeight: 1500,
        layoutHeight: 300,
    });

    it('classifies mvcp-preserved when the residual after coverage is within tolerance', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: staleObservation,
            correctorCoverage: { appliedDiffTotalPx: 823, eventCount: 2 },
        });
        expect(outcome).toMatchObject({ kind: 'mvcp-preserved', correctorCovered: true });
    });

    it('falls back as today when the corrector only partially covered the commit', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: staleObservation,
            correctorCoverage: { appliedDiffTotalPx: 600, eventCount: 1 },
        });
        expect(outcome).toMatchObject({ kind: 'needs-fallback', targetOffsetY: 820, deltaPx: 820 });
    });

    it('falls back as today when coverage carries no correction events', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: staleObservation,
            correctorCoverage: { appliedDiffTotalPx: 0, eventCount: 0 },
        });
        expect(outcome).toMatchObject({ kind: 'needs-fallback', targetOffsetY: 820 });
    });

    it('covers negative-direction corrections symmetrically', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 30, 2: 70, 3: 700, 4: 1100 },
                absoluteScrollOffset: 0,
                contentHeight: 1500,
                layoutHeight: 300,
            }),
            correctorCoverage: { appliedDiffTotalPx: -10, eventCount: 1 },
        });
        expect(outcome).toMatchObject({ kind: 'mvcp-preserved', deltaPx: -10, correctorCovered: true });
    });

    it('keeps an aligned anchor preserved without marking it corrector-covered', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 40, 2: 80, 3: 700, 4: 1100 },
                absoluteScrollOffset: 0,
                contentHeight: 1500,
                layoutHeight: 300,
            }),
            correctorCoverage: { appliedDiffTotalPx: 820, eventCount: 1 },
        });
        expect(outcome).toEqual({ kind: 'mvcp-preserved', observedItemOffsetPx: 80, deltaPx: 0 });
    });

    it('ignores non-finite coverage totals', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: staleObservation,
            correctorCoverage: { appliedDiffTotalPx: Number.NaN, eventCount: 1 },
        });
        expect(outcome).toMatchObject({ kind: 'needs-fallback', targetOffsetY: 820 });
    });

    it('classifies mvcp-preserved when the reading caught up and the residual is settle jitter', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 60, 2: 122, 3: 700, 4: 1100 },
                absoluteScrollOffset: 0,
                contentHeight: 1500,
                layoutHeight: 300,
            }),
            correctorCoverage: { appliedDiffTotalPx: 14594, eventCount: 2 },
        });
        expect(outcome).toMatchObject({ kind: 'mvcp-preserved', deltaPx: 42, correctorCovered: true });
    });

    it('treats the corrector-covered residual boundary as preserved and one px beyond as fallback', () => {
        const observationAtResidual = (residualPx: number) => postCommit({
            items,
            layoutYByIndex: { 0: 0, 1: 40, 2: 80 + residualPx, 3: 700, 4: 1100 },
            absoluteScrollOffset: 0,
            contentHeight: 1500,
            layoutHeight: 300,
        });
        const coverage = { appliedDiffTotalPx: 2944, eventCount: 1 };

        expect(observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: observationAtResidual(48),
            correctorCoverage: coverage,
        })).toMatchObject({ kind: 'mvcp-preserved', correctorCovered: true });

        expect(observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: observationAtResidual(49),
            correctorCoverage: coverage,
        })).toMatchObject({ kind: 'needs-fallback', deltaPx: 49 });
    });

    it('reads a preserved tool-group cap anchor off the cap row it measured, not a sibling tool row', () => {
        // Native prepend, reader parked on an EXPANDED tool group's header cap. The capture stored
        // the header's own top; the group's cap rows borrow the first tool message id, so resolving
        // the index by message identity measures the TOOL row instead and manufactures a corrective
        // write of exactly the header→tool distance while the reader never moved.
        const groupId = 'toolCalls:linear:t1';
        const groupItems = [
            messageItem('m0'),
            messageItem('m1'),
            { id: `${groupId}#header`, kind: 'tool-group-header', toolMessageIds: ['t1', 't2'] },
            { id: `${groupId}#tool:t1`, kind: 'tool-group-tool', toolMessageId: 't1', toolMessageIds: ['t1', 't2'] },
            { id: `${groupId}#tool:t2`, kind: 'tool-group-tool', toolMessageId: 't2', toolMessageIds: ['t1', 't2'] },
            { id: `${groupId}#footer`, kind: 'tool-group-footer', toolMessageIds: ['t1', 't2'] },
        ] as const;

        const outcome = observePrependOutcome({
            capturedAnchor: {
                key: { itemId: `${groupId}#header`, messageId: 't1' },
                itemOffsetPx: 80,
                capturedDataLength: 4,
                capturedFirstItemId: `${groupId}#header`,
            },
            postCommit: {
                items: groupItems,
                // MVCP held: the header sits at exactly its captured 80px viewport offset.
                getLayout: (index) => ({ 0: 400, 1: 700, 2: 1080, 3: 1196, 4: 1400, 5: 1600 }[index] == null
                    ? undefined
                    : { y: { 0: 400, 1: 700, 2: 1080, 3: 1196, 4: 1400, 5: 1600 }[index]! }),
                absoluteScrollOffset: 1000,
                contentHeight: 4000,
                layoutHeight: 800,
            },
        });

        expect(outcome).toEqual({ kind: 'mvcp-preserved', observedItemOffsetPx: 80, deltaPx: 0 });
    });

    it('still falls back on real partial coverage even with the wider covered tolerance', () => {
        const outcome = observePrependOutcome({
            capturedAnchor: capturedAnchor(),
            postCommit: postCommit({
                items,
                layoutYByIndex: { 0: 0, 1: 200, 2: 470, 3: 900, 4: 1300 },
                absoluteScrollOffset: 0,
                contentHeight: 1500,
                layoutHeight: 300,
            }),
            correctorCoverage: { appliedDiffTotalPx: 3047, eventCount: 4 },
        });
        expect(outcome).toMatchObject({ kind: 'needs-fallback', deltaPx: 390 });
    });
});
