import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { GlassPanel } from '@/components/ui/glass/GlassPanel';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { useUserMessageHistoryRemoteEntries } from '@/hooks/session/useUserMessageHistory';
import { t } from '@/text';
import { useTranscriptNavigationCurrentAnchorId, useTranscriptNavigationVisibleAnchorIds } from '../viewport/visibility/transcriptNavigationVisibilityStore';
import type { TranscriptPrependOlderLoadResult } from '../viewport/prepend/host/runTranscriptPrependOlderLoad';
import type { TranscriptNavigationEntry, TranscriptNavigationEntryPressHandler } from './transcriptNavigationTypes';

/** Uses the same turn index, history pager, viewport and jump owner as the rail and pane. */
export function OwnerMessageNavigation(props: Readonly<{
    sessionId: string;
    entries: readonly TranscriptNavigationEntry[];
    onJump: TranscriptNavigationEntryPressHandler;
    loadOlder: () => Promise<TranscriptPrependOlderLoadResult | null>;
    hasMoreOlder: boolean;
}>) {
    const { theme } = useUnistyles();
    const currentId = useTranscriptNavigationCurrentAnchorId(props.sessionId);
    const visibleIds = useTranscriptNavigationVisibleAnchorIds(props.sessionId);
    const current = props.entries.find((entry) => entry.id === currentId);
    const owners = React.useMemo(() => props.entries.filter((entry) => (
        entry.kind === 'user-turn' && !entry.automatedSource && entry.seq !== null
    )), [props.entries]);
    const history = useUserMessageHistoryRemoteEntries({
        sessionId: props.sessionId,
        initialBeforeSeq: props.entries.find((entry) => entry.seq !== null)?.seq ?? null,
    });
    const position = current?.seq ?? Number.POSITIVE_INFINITY;
    // When reading an answer below its prompt, Up first returns to that prompt.
    // A landed/visible prompt itself is skipped so repeated presses keep moving.
    const before = current && !visibleIds.includes(current.id) ? position + 1 : position;
    const previous = owners.filter((entry) => entry.seq! < before).at(-1);
    const next = owners.find((entry) => entry.seq! > position);
    const [searchBefore, setSearchBefore] = React.useState<number | null>(null);
    const [jumping, setJumping] = React.useState(false);
    const [loadingTranscriptHistory, setLoadingTranscriptHistory] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const mounted = React.useRef(true);
    const busy = React.useRef(false);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const jump = React.useCallback(async (entry: TranscriptNavigationEntry) => {
        busy.current = true;
        setJumping(true);
        setFailed(false);
        try {
            const result = await props.onJump(entry);
            if (mounted.current && (!result || result.status === 'not-found')) setFailed(true);
        } catch {
            if (mounted.current) setFailed(true);
        } finally {
            busy.current = false;
            if (mounted.current) setJumping(false);
        }
    }, [props.onJump]);

    // Search only after explicit intent. Pages containing only automation/agent output
    // continue through the shared pager, which also feeds the canonical turn index.
    React.useEffect(() => {
        if (searchBefore === null || history.isLoading || loadingTranscriptHistory) return;
        const target = owners.filter((entry) => entry.seq! < searchBefore).at(-1);
        if (target) {
            setSearchBefore(null);
            void jump(target);
        } else if (!history.available) {
            // Relays without the role-query index still page through the transcript owner.
            if (!props.hasMoreOlder) {
                setSearchBefore(null);
                return;
            }
            setLoadingTranscriptHistory(true);
            void props.loadOlder().then((result) => {
                if (!mounted.current) return;
                if (!result || result.status === 'not_ready' || result.status === 'in_flight') {
                    setSearchBefore(null);
                    setFailed(true);
                }
            }).catch(() => {
                if (!mounted.current) return;
                setSearchBefore(null);
                setFailed(true);
            }).finally(() => {
                if (mounted.current) setLoadingTranscriptHistory(false);
            });
        } else if (history.error || history.pendingEncryption) {
            setSearchBefore(null);
            setFailed(true);
        } else if (!history.hasMore) {
            setSearchBefore(null);
        } else {
            history.requestNextPage();
        }
    }, [history, jump, loadingTranscriptHistory, owners, props.hasMoreOlder, props.loadOlder, searchBefore]);

    const loading = jumping || searchBefore !== null;
    const canGoUp = Boolean(previous) || (history.available ? history.hasMore : props.hasMoreOlder);
    const canGoDown = Boolean(next);
    const press = (direction: 'up' | 'down') => {
        if (busy.current || searchBefore !== null) return;
        setFailed(false);
        const target = direction === 'up' ? previous : next;
        if (target) {
            void jump(target);
        } else if (direction === 'up' && canGoUp) {
            if (history.available) history.requestNextPage();
            setSearchBefore(before);
        }
    };

    return (
        <View style={styles.container}>
            {failed ? <Text accessibilityRole="alert" style={styles.error}>{t('session.transcriptNavigation.jumpFailed')}</Text> : null}
            <GlassPanel shadowLevel={2} innerShadow={false}>
                <View style={styles.buttons}>
                    {(['up', 'down'] as const).map((direction) => {
                        const disabled = loading || !(direction === 'up' ? canGoUp : canGoDown);
                        return <Pressable
                            key={direction}
                            testID={`transcript-owner-message-${direction}`}
                            accessibilityRole="button"
                            accessibilityLabel={t(direction === 'up' ? 'session.transcriptNavigation.previousOwnerMessage' : 'session.transcriptNavigation.nextOwnerMessage')}
                            accessibilityState={{ disabled, busy: loading }}
                            disabled={disabled}
                            onPress={() => press(direction)}
                            style={({ pressed }) => [styles.button, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
                        >
                            {direction === 'up' && searchBefore !== null
                                ? <ActivityIndicator size="small" color={theme.colors.text.primary} />
                                : <Icon name={direction === 'up' ? 'caret-up' : 'caret-down'} size={20} color={theme.colors.text.primary} />}
                        </Pressable>;
                    })}
                </View>
            </GlassPanel>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: { alignItems: 'flex-end', marginBottom: 8 },
    buttons: { flexDirection: 'row' },
    button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    error: { color: theme.colors.text.primary, maxWidth: 220, marginBottom: 8 },
}));
