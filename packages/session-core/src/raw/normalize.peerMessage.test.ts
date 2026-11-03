import { describe, expect, it } from 'vitest';

import { normalizeRawMessage } from './normalize.js';
import { createReducer, reducer } from '../reducer/reducer.js';

const peer = { name: 'general-purpose', handback: true };

function fold(raw: unknown, messageRole?: 'agent' | 'user') {
    const normalized = normalizeRawMessage('peer', null, 1, raw as never, messageRole ? { messageRole } : undefined);
    return reducer(createReducer(), normalized ? [normalized] : []).messages;
}

describe('typesRaw.normalizeRawMessage (peer deliveries)', () => {
    it('keeps a nested legacy peer delivery as sender-labelled text instead of a sidechain prompt', () => {
        const normalized = normalizeRawMessage('nested-peer', null, 1, { role: 'agent', content: { type: 'output', data: {
            type: 'user', uuid: 'nested-peer', isSidechain: true, sidechainId: 'parent-tool',
            origin: { kind: 'peer', name: 'general-purpose', handback: true },
            message: { role: 'user', content: 'From general-purpose:\n\nDelivered report' },
        } } } as never, { messageRole: 'agent' });
        expect(normalized).toMatchObject({ role: 'agent', sidechainId: 'parent-tool', isSidechain: true,
            content: [{ type: 'text', text: 'Delivered report', peer }] });
    });
    it('shows committed peer-delivered agent text with its sender', () => {
        const messages = fold({ role: 'agent', content: { type: 'acp', agentId: 'claude',
            data: { type: 'message', message: '**Verdict:** fixed.', peer } }, meta: { source: 'cli' } }, 'agent');
        expect(messages).toEqual([expect.objectContaining({ kind: 'agent-text', text: '**Verdict:** fixed.', peer })]);
    });

    it('keeps agent text without a well-formed sender as ordinary agent prose', () => {
        const messages = fold({ role: 'agent', content: { type: 'acp', agentId: 'claude',
            data: { type: 'message', message: 'Plain reply', peer: { name: 3 } } }, meta: { source: 'cli' } }, 'agent');
        expect(messages).toEqual([expect.objectContaining({ kind: 'agent-text', text: 'Plain reply' })]);
        expect(messages[0]).not.toHaveProperty('peer');
    });

    // 0.2 CLIs (the `readClaudePeerMessage` predecessor) write peer rows as raw Claude output with
    // a `From <sender>:` label; released 0.2 CLIs stamped them as user, later ones as agent.
    it.each(['agent', 'user'] as const)('reads a 0.2 peer output row as sender-labelled agent text, never user input (messageRole=%s)', messageRole => {
        const messages = fold({ role: 'agent', content: { type: 'output', data: { type: 'user', uuid: 'peer',
            origin: { kind: 'peer', from: 'a1', senderTaskId: 'a1', name: 'general-purpose', handback: true },
            message: { role: 'user', content: 'From general-purpose:\n\n**Verdict:** fixed.' } } }, meta: { source: 'cli' } }, messageRole);
        expect(messages).toEqual([expect.objectContaining({ kind: 'agent-text', text: '**Verdict:** fixed.', peer })]);
    });

    it('labels an unnamed 0.2 peer row as Peer and strips only that label', () => {
        const messages = fold({ role: 'agent', content: { type: 'output', data: { type: 'user', uuid: 'peer',
            origin: { kind: 'peer', from: 'uds:/tmp/sender.sock' },
            message: { role: 'user', content: 'From Peer:\n\nDelivered' } } }, meta: { source: 'cli' } }, 'agent');
        expect(messages).toEqual([expect.objectContaining({ kind: 'agent-text', text: 'Delivered', peer: { name: null, handback: false } })]);
    });
});
