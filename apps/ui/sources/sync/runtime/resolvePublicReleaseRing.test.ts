import { describe, expect, it } from 'vitest';

import { resolvePreferredPublicReleaseRingIdForApp, resolvePreferredPublicReleaseRingLabelForApp } from './resolvePublicReleaseRing';

describe('public release ring resolution', () => {
    it.each([
        {
            name: 'uses the public dev identity ring when the baked logical variant is preview',
            input: { identityVariant: 'publicdev', variant: 'preview', envAppEnv: 'preview', envExpoPublicAppEnv: 'preview' },
            id: 'publicdev',
        },
        {
            name: 'maps the publicdev variant to the publicdev ring and dev label',
            input: { variant: 'publicdev', envAppEnv: 'development', envExpoPublicAppEnv: 'development' },
            id: 'publicdev',
            label: 'dev',
        },
        {
            name: 'maps the preview variant to the preview ring and label',
            input: { variant: 'preview', envAppEnv: 'development', envExpoPublicAppEnv: 'development' },
            id: 'preview',
            label: 'preview',
        },
        {
            name: 'falls back to stable (ring and label) in production-like app variants',
            input: { variant: null, envAppEnv: 'production', envExpoPublicAppEnv: 'production' },
            id: 'stable',
            label: 'stable',
        },
        {
            name: 'prefers env APP_ENV release ring ids when variant is missing',
            input: { variant: null, envAppEnv: 'publicdev', envExpoPublicAppEnv: 'publicdev' },
            id: 'publicdev',
        },
        {
            name: 'falls back to preview in non-production app variants',
            input: { variant: null, envAppEnv: 'development', envExpoPublicAppEnv: 'development' },
            id: 'preview',
        },
    ] as const)('$name', ({ input, id, ...rest }) => {
        expect(resolvePreferredPublicReleaseRingIdForApp(input)).toBe(id);
        if ('label' in rest) expect(resolvePreferredPublicReleaseRingLabelForApp(input)).toBe(rest.label);
    });
});
