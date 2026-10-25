/** Automated attribution lives in encrypted message metadata. The pending relay flag is only classification. */
export function readAutomatedMessageSource(meta: unknown): string | null {
    if (typeof meta !== 'object' || meta === null) return null;
    const source = (meta as Record<string, unknown>).automatedSource;
    return typeof source === 'string' && source.trim().length > 0 ? source.trim() : null;
}

export function isAutomatedPendingMessage(message: Readonly<{ automated?: boolean; rawRecord?: unknown }>): boolean {
    if (message.automated === true) return true;
    const record = message.rawRecord;
    return typeof record === 'object' && record !== null
        && readAutomatedMessageSource((record as Record<string, unknown>).meta) !== null;
}

export function countOwnerPendingMessages(messages: readonly Readonly<{ automated?: boolean; rawRecord?: unknown }>[]): number {
    return messages.reduce((count, message) => count + (isAutomatedPendingMessage(message) ? 0 : 1), 0);
}

/** Older relays expose only the total. Keep their existing indicator until an owner projection is available. */
export function readOwnerPendingCount(session: Readonly<{ pendingOwnerCount?: number; pendingCount?: number }>): number {
    const count = session.pendingOwnerCount ?? session.pendingCount;
    return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}
