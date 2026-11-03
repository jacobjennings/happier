import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('expo-image', () => ({
    Image: undefined,
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                surface: '#ffffff',
                shadowLevels: {
                    2: '#000000',
                },
                textLink: '#2266ee',
            },
        },
    });
});

// The catalog is internal logic, and the testkit's own fixtures read it, so only
// the presentation leaves this case is about are overridden on top of the real module.
vi.mock('@/agents/catalog/catalog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/agents/catalog/catalog')>()),
    resolveAgentIdFromFlavor: () => null,
}));

describe('Avatar (expo-image missing)', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('renders the uploaded-image path without crashing when expo-image omits Image', async () => {
        const { Avatar } = await import('./Avatar');

        await expect(
            renderScreen(
                <Avatar
                    id="session-1"
                    imageUrl="https://example.com/avatar.png"
                    thumbhash="thumbhash"
                    size={48}
                />,
            ),
        ).resolves.toBeTruthy();
    });

    it('renders the generated artwork path without crashing when expo-image omits Image', async () => {
        const { Avatar } = await import('./Avatar');

        await expect(
            renderScreen(
                <Avatar
                    id="session-1"
                    size={48}
                />,
            ),
        ).resolves.toBeTruthy();
    });
});
