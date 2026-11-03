import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useDestinationFocus } from '@/components/appShell/workspace/destinationInstanceContext';
import { DefaultBackButton } from '@/components/navigation/Header';
import type { NavigationBackControl } from './NavigationBackChrome';

function PageBackControl(props: Readonly<{ style: React.ComponentProps<NavigationBackControl>['style']; testID: string; onBackRef: React.RefObject<() => void> }>) {
    const { theme } = useUnistyles();
    // A retained destination that is not in front must not draw (or publish) a Back of its own.
    const focused = useDestinationFocus();
    return focused ? (
        <View style={props.style}>
            <DefaultBackButton testID={props.testID} tintColor={theme.colors.text.primary} onPress={() => props.onBackRef.current()} />
        </View>
    ) : null;
}

/**
 * The Back a hosted page hands to `NavigationBackChromeProvider`. A web workspace body has no native
 * header, so the page header draws this on the title line (and the phone's retained bar takes it when
 * it shows the title). The control keeps its identity across renders; `onBack` is read when pressed.
 */
export function usePageBackControl(testID: string, onBack: () => void): NavigationBackControl {
    const onBackRef = React.useRef(onBack);
    onBackRef.current = onBack;
    return React.useCallback(
        ({ style }) => <PageBackControl style={style} testID={testID} onBackRef={onBackRef} />,
        [testID],
    );
}
