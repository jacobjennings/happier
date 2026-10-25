import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { transcriptMarkdownTextStyle } from './transcriptMarkdownTypography';
import { t } from '@/text';
import { readAutomatedMessageSource } from '@/sync/domains/messages/automatedMessage';

export function AutomatedMessageSender(props: Readonly<{ meta?: unknown; automated?: boolean; messageId: string }>) {
    const source = readAutomatedMessageSource(props.meta);
    const styles = stylesheet;
    if (!source && props.automated !== true) return null;
    const label = `${t('message.automatedSender')}${source ? ` · ${source}` : ''}`;
    return <Text accessibilityLabel={label} testID={`automated-message-sender:${props.messageId}`} style={styles.label} numberOfLines={1}>
        {label}
    </Text>;
}

const stylesheet = StyleSheet.create((theme) => ({
    label: {
        ...transcriptMarkdownTextStyle,
        color: theme.colors.text.secondary,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.text.link,
        paddingLeft: 8,
        marginBottom: 4,
    },
}));
