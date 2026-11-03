import { describe, expect, it } from 'vitest';

import {
    createTranscriptViewportLifecycle,
    type TranscriptViewportLifecycleEffect,
} from './lifecycle';
import {
    resolveSessionEntryRenderResetEffects,
} from './sessionEntryRenderResetEffects';

function sessionEntryEffects(params: Readonly<{
    platform: 'native' | 'web';
    sessionId?: string;
    shouldFollowLiveTail: boolean;
}>): readonly TranscriptViewportLifecycleEffect[] {
    return createTranscriptViewportLifecycle().dispatch({
        platform: params.platform,
        sessionId: params.sessionId ?? 'session-a',
        shouldFollowLiveTail: params.shouldFollowLiveTail,
        type: 'session-entry',
    }).effects;
}

describe('session-entry render-reset effect selector', () => {
    it('resolves web follow-bottom reset effects without native session viewport reset', () => {
        const resolved = resolveSessionEntryRenderResetEffects({
            effects: sessionEntryEffects({
                platform: 'web',
                shouldFollowLiveTail: true,
            }),
            platform: 'web',
            sessionId: 'session-a',
        });

        expect(resolved.platform).toBe('web');
        expect(resolved.nativeSessionViewportReset).toBeNull();
        expect(resolved.nativeEntrySettleReset.shouldArmConfirmation).toBe(false);
        expect(resolved.commandControllerReset.openEntryTransaction).toBe(false);
        expect(resolved.measurementReset.sessionId).toBe('session-a');
    });

    it.each([
        {
            message: 'Session-entry lifecycle did not emit command-controller reset effect',
            missingType: 'session-entry-command-controller-reset',
            platform: 'web',
        },
        {
            message: 'Session-entry lifecycle did not emit native session viewport reset effect',
            missingType: 'session-entry-native-session-viewport-reset',
            platform: 'native',
        },
    ] as const)('fails fast when $platform session entry is missing $missingType', ({ message, missingType, platform }) => {
        const effects = sessionEntryEffects({
            platform,
            shouldFollowLiveTail: true,
        }).filter((effect) => effect.type !== missingType);

        expect(() => resolveSessionEntryRenderResetEffects({
            effects,
            platform,
            sessionId: 'session-a',
        })).toThrow(message);
    });
});
