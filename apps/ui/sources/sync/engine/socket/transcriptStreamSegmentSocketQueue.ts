import type { Session } from '@/sync/domains/state/storageTypes';
import { classifySessionEventDelivery } from '@happier-dev/protocol/sessions';
import { createTranscriptStreamSegmentAssembler, type TranscriptStreamSegmentAssembler } from '@happier-dev/session-core/live';
import type {
    AnyTranscriptStreamSegmentEphemeralUpdate,
    TranscriptStreamSegmentSessionMessageEncryption,
} from '@/sync/engine/sessions/handleTranscriptStreamSegmentEphemeralUpdate';
import { handleTranscriptStreamSegmentEphemeralUpdate } from '@/sync/engine/sessions/handleTranscriptStreamSegmentEphemeralUpdate';
import type { NormalizedMessage, RawMessageNormalizationSequenceState } from '@happier-dev/session-core/raw';
import type { SessionMessageApplyCallbacks, SessionMessageApplyOptions } from '@/sync/engine/sessions/sessionMessageApplyCoalescer';

export type TranscriptStreamSegmentMessageCoalescer = Readonly<{
    enqueue: (
        sessionId: string,
        messages: NormalizedMessage[],
        options?: SessionMessageApplyOptions,
    ) => void;
    flush: (sessionId: string) => void;
}>;

export type TranscriptStreamSegmentSocketQueueEntry = Readonly<{
    update: AnyTranscriptStreamSegmentEphemeralUpdate;
    sourceServerId?: string | null;
    shouldContinue: () => boolean;
    getSessionEncryption: (sessionId: string) => TranscriptStreamSegmentSessionMessageEncryption | null;
    getSession: (sessionId: string) => Session | undefined;
    applyMessages?: (sessionId: string, messages: NormalizedMessage[]) => void;
    rawMessageNormalizationState?: RawMessageNormalizationSequenceState;
}>;

/** Stream admission and assembly; hidden checkpoints and deltas never enter a deferred queue. */
export function createTranscriptStreamSegmentSocketQueueController(params: Readonly<{
    assembler?: TranscriptStreamSegmentAssembler;
    isSessionVisible: (sessionId: string, sourceServerId?: string | null) => boolean;
    messageCoalescer: TranscriptStreamSegmentMessageCoalescer;
    createApplyCallbacks?: (entry: TranscriptStreamSegmentSocketQueueEntry) => SessionMessageApplyCallbacks | undefined;
    handleTranscriptStreamSegment?: typeof handleTranscriptStreamSegmentEphemeralUpdate;
    onDeferredRawDroppedHidden?: (fields: Readonly<{ messages: number }>) => void;
}>): Readonly<{
    handle: (entry: TranscriptStreamSegmentSocketQueueEntry) => Promise<void>;
    flush: (sessionId: string) => Promise<void>;
    drop: (sessionId: string) => void;
}> {
    const handleSegment = params.handleTranscriptStreamSegment ?? handleTranscriptStreamSegmentEphemeralUpdate;
    const assembler = params.assembler ?? createTranscriptStreamSegmentAssembler();

    async function handle(entry: TranscriptStreamSegmentSocketQueueEntry): Promise<void> {
        if (!entry.shouldContinue()) return;
        const sessionId = entry.update.sessionId;
        const liveSegments = params.isSessionVisible(sessionId, entry.sourceServerId);
        const decision = classifySessionEventDelivery({
            event: entry.update.type === 'transcript-stream-segment-delta' ? 'delta' : 'checkpoint',
            consumption: { durableBodies: liveSegments, liveSegments },
        });
        if (decision.delivery === 'skip') {
            assembler.releaseTranscriptStreamSegmentAssemblyForSession(sessionId);
            params.onDeferredRawDroppedHidden?.({ messages: 1 });
            return;
        }
        const callbacks = params.createApplyCallbacks?.(entry)
            ?? (entry.applyMessages ? { applyBatch: entry.applyMessages } : undefined);
        await handleSegment({
            assembler,
            update: entry.update,
            getSessionEncryption: entry.getSessionEncryption,
            getSession: entry.getSession,
            applyMessages: (id, messages) => params.messageCoalescer.enqueue(id, messages, {
                shouldContinue: entry.shouldContinue,
                callbacks,
            }),
            rawMessageNormalizationState: entry.rawMessageNormalizationState,
            isSessionActivelyViewed: id => params.isSessionVisible(id, entry.sourceServerId),
            skipWhenHidden: true,
        });
    }

    return {
        handle,
        flush: async sessionId => { params.messageCoalescer.flush(sessionId); },
        drop: sessionId => { assembler.releaseTranscriptStreamSegmentAssemblyForSession(sessionId); },
    };
}
