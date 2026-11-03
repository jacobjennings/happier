import * as React from 'react';
import { StyleSheet, Text } from 'react-native';
import Color from 'color';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { readHitFrameReach } from '@/dev/testkit/harness/hitFrameReach';
import { HappierUiPlatformProvider } from '@happier-dev/plugin-ui/environment';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

import { SetupBlockPaper } from './SetupBlockPaper';

describe('SetupBlockPaper', () => {
    // A card sits right under its section's ⋯ (15 px between the two drawn controls, and the ⋯'s own hit
    // area reaches 8 px below it): the ✕ takes only the 7 px left above it, so the two hit areas meet and
    // never overlap, while its free sides keep their full reach.
    it('keeps a card dismiss out of the section menu above it', async () => {
        const screen = await renderScreen(
            <HappierUiPlatformProvider platform={{ platform: 'ios', colorScheme: 'light' }}>
                <SetupBlockPaper testID="tile" layout="card" dismiss={{ label: 'Hide', onPress: () => {} }}>
                    <Text>Body</Text>
                </SetupBlockPaper>
            </HappierUiPlatformProvider>,
        );
        const reach = readHitFrameReach(screen.findByTestId('tile.dismiss')!);
        expect(reach?.top).toBe(7);
        expect(reach?.bottom).toBe(10);
        expect(reach?.left).toBe(10);
    });

    it('gives a setup card the Elements material over a backdrop and its exact paper with nothing behind', async () => {
        const { GlassMaterialSettingsProvider } = await import('@/components/ui/glass/useGlassMaterialSettings');
        const { GlassRuntimeEnvironmentProvider } = await import('@/components/ui/glass/glassRuntimeEnvironment');
        const { glassPresetMaterials } = await import('@/components/ui/glass/glassMaterial');
        const { useUnistyles } = await import('react-native-unistyles');
        const { theme } = useUnistyles();
        const scene = (atmosphereBehind: 'wallpaper' | 'none') => <GlassRuntimeEnvironmentProvider value={{ atmosphereBehind }}>
            <GlassMaterialSettingsProvider value={{ glassSurfaceMaterials: glassPresetMaterials('auto') }}>
                <SetupBlockPaper testID="backdrop-setup-paper" layout="card"><Text>Set up voice</Text></SetupBlockPaper>
            </GlassMaterialSettingsProvider>
        </GlassRuntimeEnvironmentProvider>;
        const paints = (screen: Awaited<ReturnType<typeof renderScreen>>) => screen.findAllByType('View').map(node => StyleSheet.flatten(node.props.style) ?? {});
        const screen = await renderScreen(scene('wallpaper'));
        expect(paints(screen).some(style => typeof style.backdropFilter === 'string' && style.backdropFilter.includes('blur'))).toBe(true);
        await screen.update(scene('none'));
        expect(paints(screen).some(style => typeof style.backdropFilter === 'string' && style.backdropFilter.includes('blur'))).toBe(false);
        // The same card fill and finish as every other Element on the page.
        expect(paints(screen).some(style => typeof style.backgroundColor === 'string' && Color(style.backgroundColor).hexa() === Color(theme.colors.edge.cardFill).hexa())).toBe(true);
        expect(paints(screen).some(style => typeof style.backgroundImage === 'string' && style.backgroundImage.includes('gradient'))).toBe(true);
    });
});
