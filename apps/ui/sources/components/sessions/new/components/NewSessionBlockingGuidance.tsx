import * as React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AtmosphereSurfaceFrame } from '@/components/atmosphere/AtmosphereSurfaceFrame';
import { AppHeaderCloseButton } from '@/components/navigation/AppHeaderCloseButton';
import { Header, NavigationHeaderTitle } from '@/components/navigation/Header';
import { useScreenSafeAreaBackdrop } from '@/components/navigation/safeArea/HorizontalSafeArea';
import { SessionGettingStartedGuidance } from '@/components/sessions/guidance/SessionGettingStartedGuidance';
import { useNewSessionHostNavigation } from '@/components/sessions/new/navigation/newSessionHost';
import { useNewSessionFloatingComposer } from '@/components/sessions/new/navigation/useNewSessionFloatingComposer';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

import { NewSessionWebDismissal } from './NewSessionWebDismissal';

function NativeGuidanceSurface() {
    const { router, navigation } = useNewSessionHostNavigation();
    const insets = useSafeAreaInsets();
    const { theme } = useUnistyles();
    useScreenSafeAreaBackdrop(theme.colors.surface.base);

    const close = React.useCallback(() => {
        safeRouterBack({ router, navigation, fallbackHref: '/' });
    }, [navigation, router]);
    const renderClose = React.useCallback(() => (
        <AppHeaderCloseButton testID="new-session-cancel" onPress={close} />
    ), [close]);

    // The transparent route normally gets its backdrop and dismissal from the composer.
    // Guidance replaces that composer, so it must supply both while machine setup is blocking.
    return (
        <View style={styles.surface} accessibilityViewIsModal>
            <Header title={<NavigationHeaderTitle title={t('newSession.title')} />} headerRight={renderClose} />
            <View style={[styles.content, { paddingBottom: insets.bottom }]}>
                <SessionGettingStartedGuidance variant="newSessionBlocking" />
            </View>
        </View>
    );
}

export function NewSessionBlockingGuidance(props: Readonly<{ presentation: 'screen' | 'embedded' }>) {
    const floating = useNewSessionFloatingComposer(props.presentation);
    if (props.presentation === 'screen' && Platform.OS === 'web') {
        return (
            <View style={styles.surface}>
                <AtmosphereSurfaceFrame surface="new-session">
                    <NewSessionWebDismissal>
                        <SessionGettingStartedGuidance variant="newSessionBlocking" />
                    </NewSessionWebDismissal>
                </AtmosphereSurfaceFrame>
            </View>
        );
    }
    return floating ? <NativeGuidanceSurface /> : <SessionGettingStartedGuidance variant="newSessionBlocking" />;
}

const styles = StyleSheet.create(theme => ({
    surface: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: { flex: 1 },
}));
