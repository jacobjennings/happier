import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { readAutomatedMessageSource } from '@/sync/domains/messages/automatedMessage';
import { t } from '@/text';

export function AutomatedMessageSender(props: Readonly<{ meta?: unknown; automated?: boolean; messageId: string }>) {
    const source = readAutomatedMessageSource(props.meta);
    if (!source && props.automated !== true) return null;
    const label = `${t('message.automatedSender')}${source ? ` · ${source}` : ''}`;
    return (
        <Text variant="meta" emphasis="semiBold" accessibilityLabel={label}
            testID={`automated-message-sender:${props.messageId}`} style={styles.label} numberOfLines={1}>
            {label}
        </Text>
    );
}

const styles = StyleSheet.create((theme) => ({
    label: {
        color: theme.colors.text.secondary,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.text.link,
        paddingLeft: theme.space.s8,
        marginBottom: theme.space.s4,
        flexShrink: 1,
    },
}));
