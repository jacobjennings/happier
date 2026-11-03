import * as React from 'react';
import type { ComponentProps } from 'react';
import type {
    StyleProp,
    TextInputProps as RNTextInputProps,
    TextStyle,
} from 'react-native';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { Text, TextInput, type AppTextProps } from './Text';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Text: (props: Record<string, unknown>) => React.createElement('RNText', props, props.children as React.ReactNode),
        TextInput: (props: Record<string, unknown>) => React.createElement('RNTextInput', props, props.children as React.ReactNode),
    });
});

// Core Text keeps the complete native contract even though plugin-authored
// presentation styles intentionally remain portable.
expectTypeOf<StyleProp<TextStyle> | undefined>().toMatchTypeOf<AppTextProps['style']>();
expectTypeOf<ComponentProps<typeof TextInput>['style']>().toMatchTypeOf<RNTextInputProps['style']>();

describe('Text private native-style adapter', () => {
    it('passes core-only native props and style entries to the native text host', async () => {
        const screen = await renderScreen(
            <Text
                accessibilityActions={[{ name: 'activate', label: 'Activate transcript row' }]}
                style={{ fontVariant: ['tabular-nums'] }}
                testID="core-text"
            >
                42
            </Text>,
        );

        const nativeText = screen.findByType('RNText' as never);
        if (!nativeText) {
            throw new Error('Expected the core Text adapter to render a native text host');
        }
        expect(nativeText.props.accessibilityActions).toEqual([
            { name: 'activate', label: 'Activate transcript row' },
        ]);
        expect(nativeText.props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ fontVariant: ['tabular-nums'] }),
        ]));
    });
});
