/** Attribution stays inside message metadata. The pending relay flag is classification only. */
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

/** Cold navigation consumes the relay summary without loading or decrypting queue rows. */
export function readOwnerPendingCount(session: Readonly<{ pendingOwnerCount?: number; pendingCount?: number }>): number {
    const count = session.pendingOwnerCount ?? session.pendingCount;
    return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}
