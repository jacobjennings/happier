import { describe, expect, it } from 'vitest';

import {
    resolveNativeDragActiveMirrorApplyEffects,
    resolveNativeMomentumActiveMirrorApplyEffects,
    type NativeDragActiveMirrorApplyEffect,
    type NativeMomentumActiveMirrorApplyEffect,
} from './nativeActiveMirror';

const momentumEffect = (
    overrides: Partial<NativeMomentumActiveMirrorApplyEffect> = {},
): NativeMomentumActiveMirrorApplyEffect => ({
    active: true,
    sessionId: 'session-a',
    type: 'native-momentum-active-mirror',
    ...overrides,
});

const dragEffect = (
    overrides: Partial<NativeDragActiveMirrorApplyEffect> = {},
): NativeDragActiveMirrorApplyEffect => ({
    active: true,
    sessionId: 'session-a',
    type: 'native-drag-active-mirror',
    ...overrides,
});

describe('native active mirror apply effects', () => {
    it.each([
        {
            effects: [momentumEffect({ active: true }), momentumEffect({ active: false })],
            mirror: 'momentum',
            resolve: resolveNativeMomentumActiveMirrorApplyEffects,
        },
        {
            effects: [dragEffect({ active: true }), dragEffect({ active: false })],
            mirror: 'drag',
            resolve: resolveNativeDragActiveMirrorApplyEffects,
        },
    ])('returns current-session $mirror mirror effects in order', ({ effects, resolve }) => {
        expect(resolve({
            effects,
            sessionId: 'session-a',
        })).toEqual(effects);
    });

    it('filters mixed lifecycle effects by active mirror type and current session', () => {
        const currentMomentum = momentumEffect({ active: false });
        const currentDrag = dragEffect({ active: false });
        const effects = [
            momentumEffect({ sessionId: 'session-b' }),
            dragEffect({ sessionId: 'session-b' }),
            {
                sessionId: 'session-a',
                type: 'web-immediate-release-live-tail',
            },
            {
                sessionId: 'session-a',
                type: 'web-user-scroll-preempt-entry-restore',
            },
            {
                sessionId: 'session-a',
                timestampMs: 10,
                type: 'native-touch-record-intent-timestamp',
            },
            {
                sessionId: 'session-a',
                type: 'native-bottom-follow-rearm-reset',
            },
            currentMomentum,
            currentDrag,
        ];

        expect(resolveNativeMomentumActiveMirrorApplyEffects({
            effects,
            sessionId: 'session-a',
        })).toEqual([currentMomentum]);
        expect(resolveNativeDragActiveMirrorApplyEffects({
            effects,
            sessionId: 'session-a',
        })).toEqual([currentDrag]);
    });
});
