import type { ChatListItem } from '@/components/sessions/chatListItems';
import type { TranscriptTurnUnitListItem } from '../turnGrouping/buildTranscriptTurnUnits';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { readAutomatedMessageSource } from '@/sync/domains/messages/automatedMessage';

type Item = ChatListItem | TranscriptTurnUnitListItem;
type MessageItem = Extract<Item, { kind: 'message' }>;

/** Presentation only. Run oldest-first, after turn decomposition and fork dividers. */
export function groupAutomatedTranscriptMessages(items: readonly MessageItem[], getMessageById: (id: string) => Message | null): MessageItem[];
export function groupAutomatedTranscriptMessages(items: readonly ChatListItem[], getMessageById: (id: string) => Message | null): ChatListItem[];
export function groupAutomatedTranscriptMessages(items: readonly TranscriptTurnUnitListItem[], getMessageById: (id: string) => Message | null): TranscriptTurnUnitListItem[];
export function groupAutomatedTranscriptMessages(items: readonly Item[], getMessageById: (id: string) => Message | null): Item[] {
    const output: Item[] = [];
    let anchor: MessageItem | null = null;
    let members: string[] = [];
    const flush = () => {
        if (anchor) output.push(members.length > 1 ? { ...anchor, automatedMessageIds: members } : anchor);
        anchor = null;
        members = [];
    };
    for (const item of items) {
        const message = item.kind === 'message' ? getMessageById(item.messageId) : null;
        if (item.kind !== 'message' || message?.kind !== 'user-text' || !readAutomatedMessageSource(message.meta)) {
            flush();
            output.push(item);
            continue;
        }
        if (anchor && (anchor.originSessionId !== item.originSessionId || anchor.isReadOnlyContext !== item.isReadOnlyContext)) flush();
        anchor ??= item;
        for (const id of item.automatedMessageIds ?? [item.messageId]) members.push(id);
    }
    flush();
    return output;
}
