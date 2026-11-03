export type TerminalKeyboardModifiers = readonly ('shift' | 'ctrl' | 'alt' | 'meta')[];

export type TerminalKeyboardEvent = Readonly<{
    key: string;
    modifiers: TerminalKeyboardModifiers;
}>;

export function shouldTerminalCaptureKeyboardEvent(input: Readonly<{
    key: string;
    modifiers: TerminalKeyboardModifiers;
}>): boolean {
    const normalizedKey = input.key.toLowerCase();
    const isGlobalCopy = normalizedKey === 'c' && (input.modifiers.includes('ctrl') || input.modifiers.includes('meta'));
    return !isGlobalCopy;
}
