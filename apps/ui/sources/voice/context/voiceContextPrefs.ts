import { resolveVoiceSourceDisclosureV1 } from '@happier-dev/protocol/voice/sourceDisclosureV1';

import { readVoicePrivacySettings } from '@/sync/domains/settings/readVoicePrivacySettings';
import type { ResolvedVoiceContextFormatterPrefs } from '@/voice/context/contextFormatters';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { CanonicalVoiceSettingsSchema, readVoiceSettingsInput, voiceSettingsDefaults } from '@/sync/domains/settings/voiceSettings';

function resolveVoicePrivacySettings(settings: unknown) {
  const privacy = readVoicePrivacySettings(settings);
  return {
    shareSessionSummary: privacy.shareSessionSummary,
    shareRecentMessages: privacy.shareRecentMessages,
    recentMessagesCount: privacy.recentMessagesCount,
    shareToolNames: privacy.shareToolNames,
    shareToolArgs: privacy.shareToolArgs,
    shareFilePaths: privacy.shareFilePaths,
    sharePermissionRequests: privacy.sharePermissionRequests,
    shareDeviceInventory: privacy.shareDeviceInventory,
  } as const;
}

export function getVoiceContextFormatterPrefs(params: Readonly<{
  settings: unknown;
  sessionId?: string | null;
  sessionAddress?: SessionAddress | null;
  includeInVoice?: boolean;
  isCurrentAttemptTarget?: boolean;
}>): ResolvedVoiceContextFormatterPrefs {
  const privacy = resolveVoicePrivacySettings(params.settings);
  const voice = readVoiceSettingsInput(params.settings);
  const approvalPreference = CanonicalVoiceSettingsSchema.shape.canApproveRequests.safeParse(
    voice && typeof voice === 'object' && !Array.isArray(voice)
      ? (voice as Record<string, unknown>).canApproveRequests
      : undefined,
  );
  const voiceCanApproveRequests = approvalPreference.success ? approvalPreference.data : voiceSettingsDefaults.canApproveRequests;
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';

  if (!sessionId) {
    return {
      voiceCanApproveRequests,
      voiceShareSessionSummary: privacy.shareSessionSummary,
      voiceShareRecentMessages: privacy.shareRecentMessages,
      voiceRecentMessagesCount: privacy.recentMessagesCount,
      voiceShareToolNames: privacy.shareToolNames,
      voiceShareToolArgs: privacy.shareToolArgs,
      voiceShareFilePaths: privacy.shareFilePaths,
      voiceSharePermissionRequests: privacy.sharePermissionRequests,
      voiceShareDeviceInventory: privacy.shareDeviceInventory,
    };
  }

  // One owner decides what a source Session may disclose to a Voice provider;
  // the daemon Account-Voice Follow path asks the same function.
  const disclosure = resolveVoiceSourceDisclosureV1({
    accountSettings: params.settings,
    ...(params.includeInVoice === undefined ? {} : { includeInVoice: params.includeInVoice }),
    ...(params.isCurrentAttemptTarget === undefined ? {} : { isCurrentAttemptTarget: params.isCurrentAttemptTarget }),
  });

  return {
    voiceCanApproveRequests,
    voiceShareSessionSummary: disclosure.shareSessionSummary,
    voiceShareRecentMessages: disclosure.shareRecentMessages,
    voiceRecentMessagesCount: privacy.recentMessagesCount,
    voiceShareToolNames: privacy.shareToolNames,
    voiceShareToolArgs: privacy.shareToolArgs,
    voiceShareFilePaths: privacy.shareFilePaths,
    voiceSharePermissionRequests: privacy.sharePermissionRequests,
    voiceShareDeviceInventory: privacy.shareDeviceInventory,
  };
}
