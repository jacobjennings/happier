import { resolveCodeEditorFontMetrics } from '@/components/ui/code/editor/codeEditorFontMetrics';

/** A terminal row is 19 px for the 13 px base font: tight enough that a wrapped line reads as one entry. */
const TERMINAL_LINE_HEIGHT_RATIO = 19 / 13;

export type TerminalFontMetrics = Readonly<{ fontSize: number; lineHeight: number }>;

/**
 * The one font and row-height policy of every embedded terminal (web xterm, the native WebView and the
 * native surface). The glyph size follows the code font; the row height is the terminal's own, because a
 * code editor's open line spacing makes wrapped output read as separate entries.
 */
export function resolveTerminalFontMetrics(params: Readonly<{ uiFontScale: number; osFontScale?: number }>): TerminalFontMetrics {
    const { fontSize } = resolveCodeEditorFontMetrics(params);
    return { fontSize, lineHeight: Math.max(10, Math.round(fontSize * TERMINAL_LINE_HEIGHT_RATIO)) };
}
