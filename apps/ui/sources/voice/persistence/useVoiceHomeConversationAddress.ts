import * as React from 'react';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { storage } from '@/sync/domains/state/storage';
import { findVoiceConversationSessionId } from '@/voice/persistence/voiceConversationSystemSessionLookup';

/** The Account's existing global Voice conversation, read passively (never created by a reader). */
export function useVoiceHomeConversationAddress(): SessionAddress | null {
    const serverId = useActiveServerSnapshot().serverId;
    const sessionId = storage((state) => findVoiceConversationSessionId(state));
    return React.useMemo(
        () => (sessionId ? normalizeSessionAddress(serverId, sessionId) : null),
        [serverId, sessionId],
    );
}
