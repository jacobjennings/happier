import { describe, expect, it } from 'vitest';

import { resolveTerminalHyperlinkAction } from './links';

describe('terminal hyperlink policy', () => {
    it('does not auto-open unsafe terminal hyperlinks', () => {
        expect(resolveTerminalHyperlinkAction('javascript:alert(1)')).toEqual({
            kind: 'deny',
            reason: 'unsupported_scheme',
        });
    });

    it('routes http links through host approval instead of renderer-owned opens', () => {
        expect(resolveTerminalHyperlinkAction('https://example.com/a?b=1')).toEqual({
            kind: 'prompt',
            url: 'https://example.com/a?b=1',
        });
    });
});
