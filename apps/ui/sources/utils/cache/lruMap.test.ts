import { describe, expect, it } from 'vitest';

import { LruMap } from './lruMap';

describe('LruMap', () => {
    it('evicts the least recently used entry when exceeding maxEntries', () => {
        const map = new LruMap<string, number>({ maxEntries: 2 });
        map.set('a', 1);
        map.set('b', 2);

        // Touch a so b becomes LRU.
        expect(map.get('a')).toBe(1);

        map.set('c', 3);

        expect(map.get('b')).toBeUndefined();
        expect(map.get('a')).toBe(1);
        expect(map.get('c')).toBe(3);
    });

    it('refreshes recency when an existing key is set again', () => {
        const map = new LruMap<string, number>({ maxEntries: 2 });
        map.set('a', 1);
        map.set('b', 2);
        map.set('a', 10);
        map.set('c', 3);

        expect(map.has('b')).toBe(false);
        expect(map.get('a')).toBe(10);
        expect(map.size).toBe(2);
    });

    it('evicts the oldest entries first when the capacity shrinks', () => {
        const map = new LruMap<string, number>({ maxEntries: 3 });
        map.set('a', 1);
        map.set('b', 2);
        map.set('c', 3);
        map.setMaxEntries(1);

        expect([...map.values()]).toEqual([3]);
    });

    it.each([NaN, -1])('holds nothing for an invalid capacity (%s)', (maxEntries) => {
        const map = new LruMap<string, number>({ maxEntries });
        map.set('a', 1);
        expect(map.size).toBe(0);
    });
});

