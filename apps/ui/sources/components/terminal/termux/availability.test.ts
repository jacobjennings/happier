import { describe, expect, it } from 'vitest';

import { resolveTermuxRendererSelection } from './availability';

describe('Termux terminal renderer selection', () => {
    it('keeps xterm WebView selected when Termux accessibility is unproven', () => {
        expect(resolveTermuxRendererSelection({
            featureEnabled: true,
            platform: 'android',
            accessibilityAccepted: false,
            availability: {
                available: true,
                platform: 'android',
                renderer: 'android-termux',
                moduleVersion: '0.0.0',
                accessibility: 'fallback-required',
            },
        })).toEqual({
            renderer: 'xterm-webview',
            reason: 'accessibility-unproven',
        });
    });

    it('keeps xterm WebView selected when Termux availability is for a different platform', () => {
        expect(resolveTermuxRendererSelection({
            featureEnabled: true,
            platform: 'android',
            accessibilityAccepted: true,
            availability: {
                available: true,
                platform: 'ios',
                renderer: 'android-termux',
                moduleVersion: '0.0.0',
                accessibility: 'native',
            },
        })).toEqual({
            renderer: 'xterm-webview',
            reason: 'renderer-unavailable',
        });
    });

    it('keeps xterm WebView selected with a stable reason when native availability is malformed', () => {
        expect(resolveTermuxRendererSelection({
            featureEnabled: true,
            platform: 'android',
            accessibilityAccepted: true,
            availability: { available: false },
        })).toEqual({
            renderer: 'xterm-webview',
            reason: 'renderer-unavailable',
        });
    });

    it('selects Android Termux only when feature, availability, and accessibility gates pass', () => {
        expect(resolveTermuxRendererSelection({
            featureEnabled: true,
            platform: 'android',
            accessibilityAccepted: true,
            availability: {
                available: true,
                platform: 'android',
                renderer: 'android-termux',
                moduleVersion: '0.0.0',
                accessibility: 'fallback-required',
            },
        })).toEqual({
            renderer: 'android-termux',
            availability: {
                available: true,
                platform: 'android',
                renderer: 'android-termux',
                moduleVersion: '0.0.0',
                accessibility: 'fallback-required',
            },
        });
    });
});
