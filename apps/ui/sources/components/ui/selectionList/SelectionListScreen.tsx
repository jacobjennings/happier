import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useHappierMaterialColorResolver } from '@happier-dev/plugin-ui/presentation';

import { SelectionList } from './SelectionList';
import type { SelectionListProps } from './_types';

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.colors.surface.base,
    },
}));

export type SelectionListScreenProps = Omit<SelectionListProps,
    'maxHeight' | 'heightBehavior' | 'showsVerticalScrollIndicator'>;

/**
 * Full-route host for SelectionList. SelectionList remains the sole scroll,
 * filtering, focus, and virtualization owner; this wrapper only supplies a
 * safe-area-aware viewport and route-close callback.
 */
export function SelectionListScreen(props: SelectionListScreenProps): React.ReactElement {
    const { theme } = useUnistyles();
    const paintColor = useHappierMaterialColorResolver();
    const window = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { testID = 'selection-list-screen', ...listProps } = props;
    const maxHeight = Math.max(0, window.height - insets.top - insets.bottom);

    return (
        <View testID={testID} style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: paintColor(theme.colors.surface.base, 'transparent') }]}>
            <SelectionList
                {...listProps}
                testID={`${testID}.list`}
                maxHeight={maxHeight}
                heightBehavior="fixedToMaxHeight"
                showsVerticalScrollIndicator
            />
        </View>
    );
}
