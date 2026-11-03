import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const codeBlockSpy = vi.fn();

vi.mock('@/components/ui/code/blocks/CodeBlockView', () => ({
    CodeBlockView: (props: any) => {
        codeBlockSpy(props);
        return React.createElement('CodeBlockView', props);
    },
}));

function defaultSetting(key: string): number | null {
    if (key === 'filesCodeViewJsonInferenceMaxBytes') return 50_000;
    return null;
}

const useSettingSpy = vi.fn(defaultSetting);

// CodeView reads its setting through the leaf settings read hooks, not the aggregate storage module.
vi.mock('@/sync/store/settingsReadHooks', () => ({
    useSetting: (key: string) => useSettingSpy(key),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

describe('CodeView', () => {
    afterEach(() => {
        useSettingSpy.mockImplementation(defaultSetting);
    });

    it('renders CodeBlockView with the provided code and an explicit language that overrides inference', async () => {
        codeBlockSpy.mockClear();
        const { CodeView } = await import('./CodeView');

        // JSON-looking code would infer `json`; the explicit language must win.
        await renderScreen(React.createElement(CodeView, { code: '{"ok":true}', language: 'typescript' }));

        expect(codeBlockSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                code: '{"ok":true}',
                language: 'typescript',
            }),
        );
    });

    it('infers json language for JSON-looking blocks when language is omitted', async () => {
        codeBlockSpy.mockClear();
        useSettingSpy.mockClear();
        const { CodeView } = await import('./CodeView');

        await renderScreen(React.createElement(CodeView, { code: JSON.stringify({ ok: true }, null, 2) }));

        expect(codeBlockSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                language: 'json',
            }),
        );
    });

    it('skips JSON.parse inference when code exceeds the configured max bytes', async () => {
        codeBlockSpy.mockClear();
        useSettingSpy.mockImplementation((key: string) => {
            if (key === 'filesCodeViewJsonInferenceMaxBytes') return 10;
            return null;
        });

        const { CodeView } = await import('./CodeView');
        const bigJsonLike = `{${'a'.repeat(100)}}`;

        const parseSpy = vi.spyOn(JSON, 'parse');
        parseSpy.mockImplementation(() => {
            throw new Error('should_not_parse');
        });
        try {
            await renderScreen(React.createElement(CodeView, { code: bigJsonLike }));

            expect(parseSpy).toHaveBeenCalledTimes(0);
        } finally {
            parseSpy.mockRestore();
        }
        expect(codeBlockSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                language: null,
            }),
        );
    });
});
