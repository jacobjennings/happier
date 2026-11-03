import { useLayoutEffect } from 'react';

export function createRenderCommitCounter() {
    let renders = 0;
    let commits = 0;
    return {
        render: () => { renders += 1; },
        commit: () => { commits += 1; },
        read: () => ({ renders, commits }),
        reset: () => { renders = 0; commits = 0; },
    };
}

export function useRenderCommitCounter(counter: ReturnType<typeof createRenderCommitCounter>) {
    counter.render();
    useLayoutEffect(counter.commit);
}

export function countStoreNotifications<State extends object>(store: {
    subscribe: (listener: (state: State, previous: State) => void) => () => void;
}) {
    const notifications: (keyof State)[][] = [];
    const stop = store.subscribe((state, previous) => {
        const keys = new Set([...Object.keys(previous), ...Object.keys(state)] as (keyof State)[]);
        notifications.push([...keys].filter(key => !Object.is(previous[key], state[key])));
    });
    return {
        read: (): readonly (readonly (keyof State)[])[] => notifications.map(keys => [...keys]),
        reset: () => { notifications.length = 0; },
        stop,
    };
}

export function countTransportRequests<Args extends unknown[], Result>(
    transport: (...args: Args) => Result,
    identify: (...args: Args) => string,
) {
    const counts = new Map<string, number>();
    return {
        request: (...args: Args): Result => {
            const key = identify(...args);
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return transport(...args);
        },
        read: (): Readonly<Record<string, number>> => Object.fromEntries(counts),
        reset: () => { counts.clear(); },
    };
}

export type ReadBorrowerFrame = Readonly<{
    source: string;
    method: string | null;
    line: number;
    column: number;
}>;

export type ReadBorrowerCount = Readonly<{
    provenance: readonly ReadBorrowerFrame[];
    calls: number;
    /** Sum of distinct requested ids per call; never identity across calls. */
    idCount: number;
}>;

function readBorrowerProvenance(): readonly ReadBorrowerFrame[] {
    const frames: ReadBorrowerFrame[] = [];
    for (const line of new Error().stack?.split('\n').slice(1) ?? []) {
        const frame = /^\s*at (?:(.+?) \()?(.+):(\d+):(\d+)\)?$/.exec(line);
        if (!frame) continue;
        // Keep source coordinates only: no absolute checkout paths or raw stacks.
        const source = /(?:^|\/)(?:apps\/ui\/)?(sources\/.+\.[cm]?[jt]sx?)$/.exec(frame[2]!.replaceAll('\\', '/'));
        if (!source || source[1] === 'sources/dev/testkit/performance/counts.ts') continue;
        frames.push({ source: `apps/ui/${source[1]}`, method: frame[1] ?? null,
            line: Number(frame[3]), column: Number(frame[4]) });
    }
    return frames;
}

/**
 * Observe logical read attempts before their queue loses the initiating stack.
 * Call through the real reader; count its physical transport separately. Unknown
 * source stacks remain unattributed. No ids, arguments, or raw stacks are retained.
 */
export function countReadBorrowers<Args extends unknown[], Result>(
    read: (...args: Args) => Result,
    selectIds: (...args: Args) => readonly string[],
) {
    const counts = new Map<string, { provenance: readonly ReadBorrowerFrame[]; calls: number; idCount: number }>();
    return {
        request: (...args: Args): Result => {
            const provenance = readBorrowerProvenance();
            const key = JSON.stringify(provenance);
            const current = counts.get(key) ?? { provenance, calls: 0, idCount: 0 };
            current.calls += 1;
            current.idCount += new Set(selectIds(...args)).size;
            counts.set(key, current);
            return read(...args);
        },
        read: (): readonly ReadBorrowerCount[] => [...counts.values()].map(count => ({ ...count,
            provenance: count.provenance.map(frame => ({ ...frame })) })),
        reset: () => { counts.clear(); },
    };
}
