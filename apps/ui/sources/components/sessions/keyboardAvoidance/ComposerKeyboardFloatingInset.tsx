import * as React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useComposerKeyboardLayout } from './ComposerKeyboardContext';

export function ComposerKeyboardFloatingInset(props: Readonly<{
    baseBottom?: number;
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}>): React.ReactElement {
    const layout = useComposerKeyboardLayout();
    const baseBottom = props.baseBottom ?? 0;
    // Lift the floating element with a compositor-friendly transform instead of animating the
    // `bottom` layout prop. For an absolutely positioned floating element these are equivalent:
    // a static `bottom: baseBottom` plus `translateY: -listBottomInset` moves it up by the
    // keyboard inset without triggering layout work on every keyboard frame.
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: -(layout?.listBottomInset.value ?? 0) }],
    }), [layout]);

    return (
        <Animated.View
            testID={props.testID}
            // Only the floating controls own input. Transparent spacing must not
            // cover transcript actions underneath the keyboard-offset wrapper.
            pointerEvents="box-none"
            style={[props.style, { bottom: baseBottom }, animatedStyle]}
        >
            {props.children}
        </Animated.View>
    );
}
