import {
    DEFAULT_TERMINAL_INTERACTION_POLICY,
    type TerminalInteractionPolicy,
} from './model';

const utf8Encoder = new TextEncoder();

export type TerminalPasteAction =
    | Readonly<{ kind: 'send'; input: string; bracketed: boolean }>
    | Readonly<{ kind: 'confirm'; text: string; byteLength: number; afterConfirm: Readonly<{ input: string; bracketed: boolean }> }>
    | Readonly<{ kind: 'ignore'; reason: 'empty' | 'read_only' }>;

function buildPasteInput(text: string, policy: TerminalInteractionPolicy): Readonly<{ input: string; bracketed: boolean }> {
    if (policy.bracketedPaste === 'force-wrap') {
        return {
            input: text,
            bracketed: true,
        };
    }
    return {
        input: text,
        bracketed: policy.bracketedPaste === 'preserve',
    };
}

export function resolveTerminalPasteAction(
    text: string,
    policy: TerminalInteractionPolicy = DEFAULT_TERMINAL_INTERACTION_POLICY,
): TerminalPasteAction {
    if (!text) {
        return { kind: 'ignore', reason: 'empty' };
    }

    const byteLength = utf8Encoder.encode(text).byteLength;
    const afterConfirm = buildPasteInput(text, policy);
    if (byteLength > policy.largePasteBytes) {
        return {
            kind: 'confirm',
            text,
            byteLength,
            afterConfirm,
        };
    }

    return {
        kind: 'send',
        ...afterConfirm,
    };
}
