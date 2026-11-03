import { describe, expect, it } from 'vitest';

import { resolveGhosttyRendererSelection } from './availability';

describe('Ghostty terminal renderer selection', () => {
    it('keeps xterm WebView selected when Ghostty accessibility is unproven', () => {
        expect(resolveGhosttyRendererSelection({
            featureEnabled: true,
            platform: 'ios',
            accessibilityAccepted: false,
            availability: {
                available: true,
                platform: 'ios',
                renderer: 'ios-ghosttykit',
                moduleVersion: '0.0.0',
                accessibility: 'fallback-required',
            },
        })).toEqual({
            renderer: 'xterm-webview',
            reason: 'accessibility-unproven',
        });
    });

    it('keeps xterm WebView selected when Ghostty availability is for a different platform', () => {
        expect(resolveGhosttyRendererSelection({
            featureEnabled: true,
            platform: 'ios',
            accessibilityAccepted: true,
            availability: {
                available: true,
                platform: 'android',
                renderer: 'ios-ghosttykit',
                moduleVersion: '0.0.0',
                accessibility: 'native',
            },
        })).toEqual({
            renderer: 'xterm-webview',
            reason: 'renderer-unavailable',
        });
    });

    it('keeps xterm WebView selected with a stable reason when native availability is malformed', () => {
        expect(resolveGhosttyRendererSelection({
            featureEnabled: true,
            platform: 'ios',
            accessibilityAccepted: true,
            availability: { available: false },
        })).toEqual({
            renderer: 'xterm-webview',
            reason: 'renderer-unavailable',
        });
    });

    it('selects iOS Ghostty only when feature, availability, and accessibility gates pass', () => {
        expect(resolveGhosttyRendererSelection({
            featureEnabled: true,
            platform: 'ios',
            accessibilityAccepted: true,
            availability: {
                available: true,
                platform: 'ios',
                renderer: 'ios-ghosttykit',
                moduleVersion: '0.0.0',
                accessibility: 'fallback-required',
            },
        })).toEqual({
            renderer: 'ios-ghosttykit',
            availability: {
                available: true,
                platform: 'ios',
                renderer: 'ios-ghosttykit',
                moduleVersion: '0.0.0',
                accessibility: 'fallback-required',
            },
        });
    });
});
