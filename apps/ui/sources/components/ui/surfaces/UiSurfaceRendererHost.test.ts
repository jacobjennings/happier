import { describe, expect, it } from 'vitest';

import { isUiSurfaceRendererKind } from './UiSurfaceRendererHost';

describe('isUiSurfaceRendererKind', () => {
    it('owns the closed renderer-kind admission check', () => {
        expect(isUiSurfaceRendererKind('hostedHtml')).toBe(true);
        expect(isUiSurfaceRendererKind('unknown')).toBe(false);
        expect(isUiSurfaceRendererKind(null)).toBe(false);
    });
});
