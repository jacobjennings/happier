import {
    deriveExternalSessionAttentionHasUnread as deriveExternalSessionAttentionHasUnreadSnapshot,
    readExternalSessionAttentionV1,
    type ExternalSessionAttentionV1,
} from '@happier-dev/protocol/sessions/external/linked-metadata';

export type ExternalSessionAttention = ExternalSessionAttentionV1;
type ExternalSessionAttentionInput = Readonly<{ externalSessionAttentionV1?: unknown }>;

export function readExternalSessionAttention(metadata: ExternalSessionAttentionInput | null | undefined): ExternalSessionAttention | null {
    return readExternalSessionAttentionV1(
        metadata?.externalSessionAttentionV1,
    );
}

export function deriveExternalSessionAttentionHasUnread(metadata: ExternalSessionAttentionInput | null | undefined): boolean | null {
    return deriveExternalSessionAttentionHasUnreadSnapshot(readExternalSessionAttention(metadata));
}
