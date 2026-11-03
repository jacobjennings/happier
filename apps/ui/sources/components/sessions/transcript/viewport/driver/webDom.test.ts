import { describe, expect, it } from 'vitest';

import {
    resolveWebBandExtrapolatedTranscriptItemLayout,
    scrollWebDomToTranscriptItem,
} from './webDom';
import { createWebDomScrollObservation } from './webDomObservation';

type FakeRect = Readonly<{ top: number; bottom: number; height: number }>;

class FakeElement {
    public parentElement: FakeElement | null = null;
    public querySelectorAllCalls = 0;
    public querySelectorCalls = 0;
    private readonly children: FakeElement[] = [];
    private readonly attributes = new Map<string, string>();

    public scrollHeight: number;
    public clientHeight: number;
    private scrollTopValue: number;

    public constructor(
        testId: string | null,
        private readonly rect: FakeRect,
        options: Readonly<{ scrollHeight?: number; clientHeight?: number; scrollTop?: number }> = {},
    ) {
        if (testId) this.attributes.set('data-testid', testId);
        this.scrollHeight = options.scrollHeight ?? rect.height;
        this.clientHeight = options.clientHeight ?? rect.height;
        this.scrollTopValue = options.scrollTop ?? 0;
    }

    public get scrollTop(): number {
        return this.scrollTopValue;
    }

    public set scrollTop(value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTopValue = Math.max(0, Math.min(value, max));
    }

    public appendChild(child: FakeElement): void {
        child.parentElement = this;
        this.children.push(child);
    }

    public getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    public querySelectorAll(selector: string): FakeElement[] {
        this.querySelectorAllCalls += 1;
        if (selector !== '[data-testid]') return [];
        const matches: FakeElement[] = [];
        const visit = (node: FakeElement) => {
            if (node.getAttribute('data-testid') != null) matches.push(node);
            for (const child of node.children) visit(child);
        };
        for (const child of this.children) visit(child);
        return matches;
    }

    public querySelector(selector: string): FakeElement | null {
        this.querySelectorCalls += 1;
        const match = selector.match(/^\[data-testid="((?:\\.|[^"\\])*)"\]$/);
        if (!match) return null;
        const targetTestId = match[1].replace(/\\(["\\])/g, '$1');
        const visit = (node: FakeElement): FakeElement | null => {
            if (node.getAttribute('data-testid') === targetTestId) return node;
            for (const child of node.children) {
                const found = visit(child);
                if (found) return found;
            }
            return null;
        };
        for (const child of this.children) {
            const found = visit(child);
            if (found) return found;
        }
        return null;
    }

    public getBoundingClientRect(): FakeRect {
        return this.rect;
    }
}

function createMetrics(params: Readonly<{
    itemId?: string;
    itemTop?: number;
    scrollTop?: number;
}> = {}) {
    const itemTop = params.itemTop ?? 320;
    const itemHeight = 120;
    const container = new FakeElement(null, {
        top: 100,
        bottom: 500,
        height: 400,
    }, {
        clientHeight: 400,
        scrollHeight: 2000,
        scrollTop: params.scrollTop ?? 100,
    });
    const item = new FakeElement(`transcript-item-${params.itemId ?? 'm2'}`, {
        top: 100 + itemTop,
        bottom: 100 + itemTop + itemHeight,
        height: itemHeight,
    });
    container.appendChild(item);

    return {
        metrics: {
            element: container as unknown as HTMLElement,
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
        },
        container,
        item,
    };
}

describe('resolveWebBandExtrapolatedTranscriptItemLayout', () => {
    function createBandContainer(params: Readonly<{
        mounted: readonly Readonly<{ itemId: string; top: number; height: number }>[];
        scrollTop?: number;
    }>) {
        const container = new FakeElement(null, { top: 100, bottom: 500, height: 400 }, {
            clientHeight: 400,
            scrollHeight: 20_000,
            scrollTop: params.scrollTop ?? 0,
        });
        for (const row of params.mounted) {
            // rects are viewport-relative: content offset = rect.top - container.top + scrollTop
            container.appendChild(new FakeElement(`transcript-item-${row.itemId}`, {
                top: 100 + row.top - (params.scrollTop ?? 0),
                bottom: 100 + row.top + row.height - (params.scrollTop ?? 0),
                height: row.height,
            }));
        }
        return container;
    }

    const listData = Array.from({ length: 100 }, (_, index) => ({ id: `it-${index}` }));

    it('interpolates the unmounted target position between mounted neighbors by index', () => {
        const container = createBandContainer({
            scrollTop: 5_000,
            mounted: [
                { itemId: 'it-40', top: 5_000, height: 100 },
                { itemId: 'it-50', top: 6_000, height: 100 },
            ],
        });

        const layout = resolveWebBandExtrapolatedTranscriptItemLayout({
            container: container as unknown as HTMLElement,
            listData: listData as never,
            scrollTop: 5_000,
            targetIndex: 45,
        });

        expect(layout).not.toBeNull();
        expect(Math.round(layout!.y)).toBe(5_500);
    });

    it('extrapolates past the mounted band edge using the measured band average row height', () => {
        // Band rows 40..49 measured at 200px each; target index 30 sits ten rows above the band.
        const mounted = Array.from({ length: 10 }, (_, i) => ({
            itemId: `it-${40 + i}`,
            top: 8_000 + i * 200,
            height: 200,
        }));
        const container = createBandContainer({ scrollTop: 8_000, mounted });

        const layout = resolveWebBandExtrapolatedTranscriptItemLayout({
            container: container as unknown as HTMLElement,
            listData: listData as never,
            scrollTop: 8_000,
            targetIndex: 30,
        });

        expect(layout).not.toBeNull();
        expect(Math.round(layout!.y)).toBe(8_000 - 10 * 200);
    });

    it('returns null when no listData rows are mounted', () => {
        const container = createBandContainer({ mounted: [] });

        const layout = resolveWebBandExtrapolatedTranscriptItemLayout({
            container: container as unknown as HTMLElement,
            listData: listData as never,
            scrollTop: 0,
            targetIndex: 45,
        });

        expect(layout).toBeNull();
    });
});

describe('web DOM viewport driver', () => {
    it('uses exact transcript item lookup instead of scanning every test id descendant', () => {
        const itemId = 'm:2/[quoted]"\\slash';
        const { metrics, container } = createMetrics({ itemId, itemTop: 260, scrollTop: 80 });
        for (let i = 0; i < 300; i += 1) {
            container.appendChild(new FakeElement(`unrelated-${i}`, {
                top: 0,
                bottom: 1,
                height: 1,
            }));
        }

        const result = scrollWebDomToTranscriptItem({
            align: { kind: 'top-with-item-offset', itemOffsetPx: 40 },
            itemId,
            metrics,
            observation: createWebDomScrollObservation(),
        });

        expect(result).toEqual({
            ok: true,
            landedScrollTop: 300,
            targetScrollTop: 300,
        });
        expect(container.querySelectorCalls).toBe(1);
        expect(container.querySelectorAllCalls).toBe(0);
    });

    it('reports not_found without writing when the item is not mounted in the DOM', () => {
        const { metrics, container } = createMetrics({ itemId: 'visible' });
        const result = scrollWebDomToTranscriptItem({
            align: { kind: 'center' },
            itemId: 'missing',
            metrics,
            observation: createWebDomScrollObservation(),
        });

        expect(result).toEqual({ ok: false, reason: 'not_found' });
        expect(container.scrollTop).toBe(100);
    });
});
