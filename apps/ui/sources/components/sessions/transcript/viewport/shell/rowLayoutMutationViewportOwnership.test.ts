import { describe, expect, it } from 'vitest';

import { resolveRowLayoutMutationViewportOwnershipAction } from './rowLayoutMutationViewportOwnership';

describe('resolveRowLayoutMutationViewportOwnershipAction', () => {
    // Live native S-C continuation (2026-07-11): the tool ROW inline expand/collapse
    // (ToolTimelineRow -> TranscriptCollapsible) commits a giant in-viewport height change
    // WITHOUT passing the group-toggle choke point, so no visible-anchor hold was armed and
    // the expansion parked the viewport hours away (offset 5559 -> 2590, firstVisibleItemId
    // changed, zero writer events). Every expand/collapse row mutation must arm the ONE keyed hold.
    // Bounded async content replacement or growth arms the same hold; a non-toggle signature
    // change (streaming re-signature) must never arm, or tail-follow and MVCP fight a hold.
    it.each([
        { reason: 'expand', action: 'arm-visible-anchor-hold' },
        { reason: 'collapse', action: 'arm-visible-anchor-hold' },
        { reason: 'content-change', action: 'arm-visible-anchor-hold' },
        { reason: 'signature-change', action: 'none' },
    ] as const)('resolves $reason row mutations to $action', ({ reason, action }) => {
        expect(resolveRowLayoutMutationViewportOwnershipAction({ reason })).toBe(action);
    });
});
