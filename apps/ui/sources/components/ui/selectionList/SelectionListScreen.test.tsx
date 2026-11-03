import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { flattenTestStyle, renderScreen } from '@/dev/testkit';
import { HappierMaterialRoleProvider } from '@happier-dev/plugin-ui/presentation';

// The window and the device insets are platform boundaries; the rest of the safe-area module
// (initialWindowMetrics, providers) stays real, since navigation elements read it at import.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 800, height: 800, scale: 2, fontScale: 1 }) });
});
vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-native-safe-area-context')>(),
    useSafeAreaInsets: () => ({ top: 12, right: 0, bottom: 20, left: 0 }),
}));

import { SelectionListScreen } from './SelectionListScreen';

const rootStep = { id: 'models', sections: [{ kind: 'static' as const, id: 'all', options: [{ id: 'm-1', label: 'Model one' }] }] };

describe('SelectionListScreen', () => {
    it('keeps the full-route host clear inside a material plane and restores its exact solid ground', async () => {
        const content = <SelectionListScreen rootStep={rootStep} selectedOptionId={null} onSelect={() => {}} onRequestClose={() => {}} testID="material-screen" />;
        const screen = await renderScreen(content);
        const solid = flattenTestStyle(screen.findByTestId('material-screen')!.props.style);
        await screen.update(<HappierMaterialRoleProvider role="content" resolveMaterialColor={input => input.translucentColor ?? input.color}>{content}</HappierMaterialRoleProvider>);
        expect(flattenTestStyle(screen.findByTestId('material-screen')!.props.style)).toMatchObject({ backgroundColor: 'transparent', paddingTop: solid.paddingTop, paddingBottom: solid.paddingBottom });
        await screen.update(content);
        expect(flattenTestStyle(screen.findByTestId('material-screen')!.props.style)).toEqual(solid);
    });
    it('gives SelectionList one safe-area-aware fixed viewport and delegates close', async () => {
        const onRequestClose = vi.fn();
        const screen = await renderScreen(
            <SelectionListScreen
                rootStep={rootStep}
                selectedOptionId={null}
                onSelect={() => {}}
                onRequestClose={onRequestClose}
                testID="models-screen"
            />,
        );
        // 800 px window minus the 12 + 20 px insets, held as a fixed frame rather than a content-sized one.
        const list = screen.findHostByTestId('models-screen.list')!;
        expect(flattenTestStyle(list.props.style)).toMatchObject({ maxHeight: 768, height: 768 });
        expect(screen.findAll(node => typeof node.type === 'string' && node.props.showsVerticalScrollIndicator === true).length).toBeGreaterThan(0);
        await act(async () => {
            (list.props.onKeyDown as (event: unknown) => void)({ key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} });
        });
        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });
});
