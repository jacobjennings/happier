import { describe, expect, it } from 'vitest';

import {
    createFriendsStackScreenOptions,
    createInboxStackScreenOptions,
} from './createSocialStackScreenOptions';

describe('createSocialStackScreenOptions', () => {
    const translate = (key: string) => key;

    it.each([
        ['friends', createFriendsStackScreenOptions, 'tabs.friends'],
        ['inbox', createInboxStackScreenOptions, 'tabs.inbox'],
    ] as const)('uses the %s tab label for its stack header', (_name, create, headerTitle) => {
        expect(create(translate)).toEqual({
            headerShown: false,
            headerTitle,
            headerBackTitle: 'common.home',
        });
    });
});
