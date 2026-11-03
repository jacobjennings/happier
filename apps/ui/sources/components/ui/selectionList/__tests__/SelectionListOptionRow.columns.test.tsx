/**
 * Lane G4 — `PlanSuccessRows` row identity and column count.
 *
 * `PlanSuccessRows` uses no hooks, so it can be invoked as a plain function and
 * its returned element tree read directly: that is the only place a visual
 * row's React key is observable. The rendered layout itself — no column
 * wrapper at one column, row-major cells, disabled options kept as cells, a
 * trailing partial row — is proven through the public SelectionList by
 * `SelectionList.columns.test.tsx`, `SelectionListCardRowGap.test.tsx`,
 * `SelectionList.columnsWithExpandedContent.test.tsx` and
 * `SelectionList.a11yPatternStability.test.tsx`.
 */

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlanSuccessRows, type RenderPlanRowsProps } from '../SelectionListOptionRow';
import type { SectionRenderPlan } from '../SelectionListRenderPlan';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const onSelect = vi.fn();
const onPushStep = vi.fn();

function makePlan(count: number): SectionRenderPlan {
    return {
        id: 'models',
        options: Array.from({ length: count }, (_, index) => ({
            id: `opt-${index}`,
            label: `Option ${index}`,
        })),
    };
}

function makeProps(overrides: Partial<RenderPlanRowsProps> = {}): RenderPlanRowsProps {
    return {
        plan: makePlan(5),
        rootTestID: 'sl',
        stepId: 'root',
        selectedOptionIds: new Set<string>(),
        focusedOptionId: null,
        onSelect,
        onPushStep,
        ...overrides,
    };
}

function childrenOf(element: React.ReactElement): React.ReactElement[] {
    const { children } = element.props as { children?: React.ReactNode };
    return React.Children.toArray(children) as React.ReactElement[];
}

describe('PlanSuccessRows — multi-column layout', () => {
    it('keys each visual row by its leading option so rows keep identity', () => {
        // Read the raw children array: `React.Children.toArray` rewrites keys
        // with its own prefix, which would hide the key we actually assign.
        const visualRows = (PlanSuccessRows(makeProps({ columnCount: 2 }))
            .props as { children: React.ReactElement[] }).children;
        expect(visualRows.map((visualRow) => visualRow.key)).toEqual([
            'column-row:opt-0',
            'column-row:opt-2',
            'column-row:opt-4',
        ]);
    });

    it('carries three columns through when the layout resolved three', () => {
        const visualRows = childrenOf(PlanSuccessRows(makeProps({ plan: makePlan(7), columnCount: 3 })));
        expect(visualRows).toHaveLength(3);
        expect(visualRows.map((visualRow) => (
            (visualRow.props as { children: React.ReactElement[] }).children.length
        ))).toEqual([3, 3, 1]);
        for (const visualRow of visualRows) {
            expect((visualRow.props as { columnCount: number }).columnCount).toBe(3);
        }
    });
});
