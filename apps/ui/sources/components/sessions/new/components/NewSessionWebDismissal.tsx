import * as React from 'react';
import { View } from 'react-native';

import { HAPPIER_ICON_BUTTON_SIZE } from '@happier-dev/plugin-ui/presentation';

import { IconButton } from '@/components/ui/buttons/IconButton';
import { ESCAPE_LAYER_PRIORITIES, EscapeLayerProvider, useEscapeLayer } from '@/keyboard/escape';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { useSetting } from '@/sync/store/hooks';
import { useNewSessionHostNavigation } from '../navigation/newSessionHost';
import { resolveNewSessionRoutePresentation } from '../navigation/newSessionPresentation';

/** Beside the Look control that the atmosphere frame seats in the card's top-right corner. */
const CLOSE_RIGHT_OFFSET = 52;
const CLOSE_TOP_OFFSET = 14;
/**
 * The card's corner controls (Look and close) sit in a row of their own: the wizard's scroller starts
 * below it, so its first heading never sits under them and scrolled content never runs beneath them.
 */
const CORNER_CONTROLS_ROW_HEIGHT = CLOSE_TOP_OFFSET + HAPPIER_ICON_BUTTON_SIZE;

/**
 * Leaving New Session on the web. Expo Router's web route card is a bare drawer: it paints no header,
 * so the route's header close never shows, and a `/new` opened directly has no prior route for the
 * drawer's own Escape and backdrop dismissal to pop. The screen therefore carries its own close and
 * a modal Escape layer, scoping its pickers under it so that a picker consumes Escape first.
 */
export function NewSessionWebDismissal(props: React.PropsWithChildren): React.ReactElement {
    const { router, navigation } = useNewSessionHostNavigation();
    const mode = useSetting('newSessionPresentationModeV1');
    // Forced screens keep the navigator's header action (also lent into the desktop shell).
    // Only modal routes need this replacement for the web drawer's missing header.
    const modal = resolveNewSessionRoutePresentation({ mode, platformOs: 'web' }) !== undefined;
    const close = React.useCallback(() => safeRouterBack({ router, navigation, fallbackHref: '/' }), [navigation, router]);
    const escapeLayer = useEscapeLayer({
        enabled: modal,
        priority: ESCAPE_LAYER_PRIORITIES.modal,
        allowEditableTarget: true,
        onEscape: () => {
            close();
            return true;
        },
    });
    if (!modal) return <>{props.children}</>;
    return (
        <EscapeLayerProvider layer={escapeLayer}>
            <View accessibilityViewIsModal style={{ flex: 1, minHeight: 0, paddingTop: CORNER_CONTROLS_ROW_HEIGHT }}>{props.children}</View>
            <View style={{ position: 'absolute', right: CLOSE_RIGHT_OFFSET, top: CLOSE_TOP_OFFSET }}>
                <IconButton
                    testID="new-session-cancel"
                    iconName="x"
                    variant="plain"
                    accessibilityLabel={t('common.cancel')}
                    onPress={close}
                />
            </View>
        </EscapeLayerProvider>
    );
}
