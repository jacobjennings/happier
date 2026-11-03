import { describe, expect, it } from 'vitest';

import {
    resolveMainTranscriptListShellFrame,
    resolveReadOnlyTranscriptListShellFrame,
    resolveSidechainTranscriptListShellFrame,
} from './transcriptListShellCapabilities';

describe('transcript list shell frame contracts', () => {
    it('resolves main web and native frame facts explicitly', () => {
        const web = resolveMainTranscriptListShellFrame({
            nativeID: 'transcript-web',
            platformOS: 'web',
        });
        const native = resolveMainTranscriptListShellFrame({
            nativeID: 'transcript-native',
            platformOS: 'ios',
        });

        expect(web).toMatchObject({
            capability: { kind: 'main', streamingFollow: { kind: 'main' } },
            dataOrder: 'oldest-first',
            platform: 'web',
            renderer: 'legendList',
            rendererOptions: {
                continuousFollow: { endThresholdRatio: 0.1 },
                identity: { nativeID: 'transcript-web', testID: 'transcript-chat-list' },
                initialPlacement: { atEnd: true },
                interaction: { scrollEventThrottle: 32 },
            },
        });
        expect(native).toMatchObject({
            capability: { kind: 'main', streamingFollow: { kind: 'main' } },
            dataOrder: 'newest-first',
            platform: 'native',
            renderer: 'legendList',
            rendererOptions: {
                continuousFollow: { endThresholdRatio: 0.1 },
                identity: { nativeID: 'transcript-native', testID: 'transcript-chat-list' },
                initialPlacement: { atEnd: true },
                interaction: { scrollEventThrottle: 16 },
            },
        });
    });

    it('resolves read-only and sidechain capability contracts without main-only identity', () => {
        const readOnly = resolveReadOnlyTranscriptListShellFrame({
            accessKind: 'public',
            bottomNoticeVisible: true,
            platformOS: 'web',
        });
        const sidechain = resolveSidechainTranscriptListShellFrame({ platformOS: 'ios' });

        expect(readOnly.capability).toMatchObject({
            boundedHydration: { kind: 'readOnly' },
            canApprovePermissions: false,
            canSendMessages: false,
            kind: 'readOnly',
        });
        expect(readOnly.rendererOptions.identity.nativeID).toBeUndefined();
        expect(sidechain.capability).toMatchObject({
            boundedHydration: { kind: 'sidechain' },
            initialBottomPin: true,
            kind: 'sidechain',
            olderPagination: true,
        });
        expect(sidechain.rendererOptions.identity.nativeID).toBeUndefined();
    });
});
