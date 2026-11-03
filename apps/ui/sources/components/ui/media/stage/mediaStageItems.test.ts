import { describe, expect, it } from 'vitest';
import { freezeMediaStageGallery, type MediaStageItem } from './mediaStageItems';

describe('media stage gallery snapshot', () => {
    it('starts at a valid selected item and rejects an empty gallery', () => {
        const items: MediaStageItem[] = [{ kind: 'image', title: 'One', source: { enabled: true, source: { kind: 'uri', uri: 'blob:one' } } }];
        expect(freezeMediaStageGallery(items, 20).initialIndex).toBe(0);
        expect(() => freezeMediaStageGallery([], 0)).toThrow(RangeError);
    });
});
