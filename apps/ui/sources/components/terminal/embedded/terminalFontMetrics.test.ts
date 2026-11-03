import { describe, expect, it } from 'vitest';

import { resolveCodeEditorFontMetrics } from '@/components/ui/code/editor/codeEditorFontMetrics';
import { resolveTerminalFontMetrics } from './terminalFontMetrics';

describe('resolveTerminalFontMetrics', () => {
    it('sets terminal rows tighter than a code editor line, so wrapped output reads as one entry', () => {
        const terminal = resolveTerminalFontMetrics({ uiFontScale: 1 });
        const code = resolveCodeEditorFontMetrics({ uiFontScale: 1 });
        expect(terminal.fontSize).toBe(code.fontSize);
        expect(terminal.lineHeight).toBeLessThan(code.lineHeight);
        // Rows stay open enough for the glyphs: 1.3–1.5 x the font size.
        expect(terminal.lineHeight / terminal.fontSize).toBeGreaterThanOrEqual(1.3);
        expect(terminal.lineHeight / terminal.fontSize).toBeLessThanOrEqual(1.5);
    });

    it('follows the interface and OS font scale together', () => {
        const scaled = resolveTerminalFontMetrics({ uiFontScale: 2, osFontScale: 1.25 });
        expect(scaled.fontSize).toBe(resolveCodeEditorFontMetrics({ uiFontScale: 2, osFontScale: 1.25 }).fontSize);
        expect(scaled.lineHeight / scaled.fontSize).toBeCloseTo(
            resolveTerminalFontMetrics({ uiFontScale: 1 }).lineHeight / resolveTerminalFontMetrics({ uiFontScale: 1 }).fontSize, 1);
    });
});
