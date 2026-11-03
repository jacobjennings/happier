import { describe, expect, it } from 'vitest';

import { resolveNativeScrollObservationAnchorCaptureSuppression } from './nativeScrollAnchorCaptureSuppression';

describe('resolveNativeScrollObservationAnchorCaptureSuppression', () => {
    // Passive native movement must not overwrite the saved reading anchor, unless active momentum
    // still carries trusted drag attribution; observations allowed to refresh anchors never suppress.
    it.each([
        { momentum: false, suppress: true, trustedDrag: false, expected: true },
        { momentum: true, suppress: true, trustedDrag: false, expected: true },
        { momentum: false, suppress: true, trustedDrag: true, expected: true },
        { momentum: true, suppress: true, trustedDrag: true, expected: false },
        { momentum: false, suppress: false, trustedDrag: false, expected: false },
        { momentum: true, suppress: false, trustedDrag: true, expected: false },
    ])(
        'returns $expected for suppress=$suppress, momentum=$momentum, trusted drag=$trustedDrag',
        ({ expected, momentum, suppress, trustedDrag }) => {
            expect(resolveNativeScrollObservationAnchorCaptureSuppression({
                nativeMomentumScrollActive: momentum,
                shouldSuppressNativeAnchorCapture: suppress,
                trustedDragSessionActive: trustedDrag,
            })).toBe(expected);
        },
    );
});
