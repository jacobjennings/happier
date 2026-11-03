import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HAPPIER_TYPE_SCALE, happierPageTextMetrics } from '@happier-dev/plugin-ui/presentation';
import type { WorkspaceAddressV1 } from '@happier-dev/protocol/workspaces/workspaceRefV1';

import { SessionListIdentity } from '@/components/sessions/shell/SessionListIdentity';
import { isMobileLayoutWidth } from '@/components/sessions/layout/isMobileLayoutWidth';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Typography } from '@/constants/Typography';
import { storage } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { useServerCredentialAccountScopeBinding } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useSessionSelector } from '@/sync/store/hooks';
import { selectProjectAuthoringSessionRelationship, selectProjectLastAuthoringSessionId } from '@/sync/store/selectProjectLastAuthoringSessionId';
import { readProjectSessionAuthoringOrigin } from '@/components/projects/detail/projectRouteState';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { formatAsOfTime } from '@/utils/time/formatAsOfTime';
import { t } from '@/text';
import { useProjectAuthoringReturn } from './useProjectSetupAuthoring';

/** Server-visible ids discover one private Session; older rows retain hydrated provenance discovery. */
export const ProjectSetupAuthoredLine = React.memo(function ProjectSetupAuthoredLine(props: Readonly<{ workspace: WorkspaceAddressV1; compact?: boolean }>) {
  const { binding } = useServerCredentialAccountScopeBinding(props.workspace.serverId);
  const accountId = binding?.isCurrent() ? binding.accountId : null;
  const addressKey = storage(state => {
    const relationship = selectProjectAuthoringSessionRelationship(state, props.workspace, accountId);
    if (relationship) return JSON.stringify([relationship.serverId, relationship.sessionId]);
    const id = selectProjectLastAuthoringSessionId(state, props.workspace, accountId);
    return id ? JSON.stringify([state.sessions[id]?.serverId ?? props.workspace.serverId, id]) : null;
  });
  const address = React.useMemo(() => addressKey ? JSON.parse(addressKey) as [string, string] : null, [addressKey]);
  if (!address) return null;
  return <ProjectSetupAuthoredLineBody serverId={address[0]} sessionId={address[1]} compact={props.compact === true} />;
});

function ProjectSetupAuthoredLineBody(props: Readonly<{ serverId: string; sessionId: string; compact: boolean }>) {
  const { theme } = useUnistyles();
  const session = useSessionSelector(props.sessionId, props.serverId, value => value);
  React.useEffect(() => {
    // The exact-read owner coalesces concurrent demand. No turns, transcript, census or idle refresh.
    void sync.ensureSessionVisibleForMessageRoute(props.sessionId, {
      serverId: props.serverId, hydrateMessages: false, includeTurnsProjection: false,
    }).catch(() => { /* A missing/unavailable Session supplies no invented provenance. */ });
  }, [props.serverId, props.sessionId]);
  const origin = React.useMemo(() => session ? readProjectSessionAuthoringOrigin(readSessionOwnerMetadataView(session)) : null, [session]);
  const changesOrigin = React.useMemo(() => origin ? { ...origin, page: 'changes' as const } : null, [origin]);
  const changes = useProjectAuthoringReturn(changesOrigin);
  const { width, fontScale } = useWindowDimensions();
  const compact = props.compact || isMobileLayoutWidth(width);
  const sessionName = session ? getSessionName(session) : '';
  const text = session ? t('projects.authoring.lastSession', { session: sessionName, time: formatAsOfTime(session.updatedAt) }) : '';
  const at = sessionName ? text.indexOf(sessionName) : -1;
  return (
    <ItemGroup surface="none">
      <View testID="project-setup-authored" style={[styles.authored, { backgroundColor: theme.colors.surface.inset }]}>
        {session ? <SessionListIdentity session={session} display="agentLogo" serverId={props.serverId}
          color={theme.colors.text.secondary} avatarSize={14} agentLogoSize={14} connected /> : null}
        {/* The two-line footprint is reserved by this box, so one line sits centred beside the mark and button. */}
        <View style={[styles.authoredBody, { minHeight: HAPPIER_TYPE_SCALE.meta.lineHeight * fontScale * 2 }]}>
          <Text style={[styles.authoredText, { color: theme.colors.text.secondary }]} numberOfLines={2}>
            {at < 0 ? text : <>{text.slice(0, at)}<Text style={[styles.authoredText, styles.authoredSession,
              { color: theme.colors.text.primary }]}>{sessionName}</Text>{text.slice(at + sessionName.length)}</>}
          </Text>
        </View>
        {!compact && changes.destination.kind === 'ready' ? <RoundButton testID="project-setup-authored.changes" size="small"
          display="inverted" title={t('projects.authoring.reviewChanges')} onPress={() => { changes.onReturnToProject(); }} /> : null}
      </View>
    </ItemGroup>
  );
}

const styles = StyleSheet.create(() => ({
  authored: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  authoredSession: { ...Typography.default('semiBold') },
  authoredBody: { flex: 1, minWidth: 0, justifyContent: 'center' },
  authoredText: { ...Typography.default('regular'), ...happierPageTextMetrics('meta') },
}));
