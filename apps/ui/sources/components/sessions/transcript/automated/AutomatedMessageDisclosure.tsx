import * as React from 'react';
import { View } from 'react-native';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { readAutomatedMessageSource } from '@/sync/domains/messages/automatedMessage';
import { transcriptMarkdownTextStyle } from '../transcriptMarkdownTypography';
import { useTranscriptRowLayoutMutation } from '../measurement/TranscriptRowLayoutMutationContext';

export const AUTOMATED_MESSAGE_DISCLOSURE_MIN_HEIGHT = 48;

export function AutomatedMessageDisclosure(props: Readonly<{
    messageId: string;
    meta?: unknown;
    text: string;
    count?: number;
    children: React.ReactNode;
}>) {
    const { theme } = useUnistyles();
    const maxWidth = useLayoutMaxWidth();
    const [expansion, setExpansion] = React.useState({ messageId: props.messageId, expanded: false });
    const expanded = expansion.messageId === props.messageId && expansion.expanded;
    const notifyLayoutMutation = useTranscriptRowLayoutMutation();
    const count = props.count ?? 1;
    const source = readAutomatedMessageSource(props.meta);
    const label = `${t('message.automatedSender')}${count > 1 ? ` (${count})` : ''}${source ? ` · ${source}` : ''}`;
    const firstLine = props.text.trim().split(/\r?\n/, 1)[0];
    return (
        <View style={[styles.container, { maxWidth }]}>
            <PressableSurface
                testID={`automated-message-disclosure:${props.messageId}`}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${firstLine}`}
                accessibilityState={{ expanded }}
                onPress={() => {
                    notifyLayoutMutation({ reason: expanded ? 'collapse' : 'expand', sourceId: props.messageId });
                    setExpansion({ messageId: props.messageId, expanded: !expanded });
                }}
                style={styles.header}
            >
                <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color={theme.colors.text.secondary} />
                <Text style={styles.preview} numberOfLines={1}>
                    <Text testID={`automated-message-sender:${props.messageId}`} style={styles.label}>{label}</Text>{firstLine ? `: ${firstLine}` : ''}
                </Text>
            </PressableSurface>
            {expanded ? props.children : null}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: { marginBottom: 8, width: '100%', alignSelf: 'center' },
    header: {
        minHeight: AUTOMATED_MESSAGE_DISCLOSURE_MIN_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.text.link,
    },
    preview: { ...transcriptMarkdownTextStyle, color: theme.colors.text.secondary, flex: 1 },
    label: { fontWeight: '600' },
}));
