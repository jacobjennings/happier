import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('expo-image', () => ({
    Image: (props: any) => React.createElement('Image', props, props.children),
}));

vi.mock('react-native-svg', () => ({
    SvgXml: (props: any) => React.createElement('SvgXml', props),
}));

vi.mock('./AvatarGradient', () => ({
    AvatarGradient: (props: any) => React.createElement('AvatarGradient', props),
}));

vi.mock('./AvatarSkia', () => ({
    AvatarSkia: (props: any) => React.createElement('AvatarSkia', props),
}));

vi.mock('./AvatarBrutalist', () => ({
    AvatarBrutalist: (props: any) => React.createElement('AvatarBrutalist', props),
}));

/**
 * The Agent mark on an avatar is a brand claim about which Agent produced the
 * session. The catalog only carries presentation for bundled Agents, so a
 * session run by an installed or otherwise unresolvable Agent has no mark to
 * show — and showing the product default in its place would tell the user the
 * session belongs to Claude.
 */
describe('Avatar Agent mark', () => {
    async function renderAvatar(element: React.ReactElement) {
        const { tree } = await renderScreen(element);
        return tree;
    }

    it('shows the bundled Agent’s own mark', async () => {
        const { Avatar } = await import('./Avatar');

        const tree = await renderAvatar(<Avatar id="session-1" flavor="claude" size={48} />);

        expect(tree.findAllByType('SvgXml' as any).length).toBe(1);
    });

    it.each([
        ['an installed Agent with no bundled presentation', 'acme.agent/custom-agent'],
        ['a session whose Agent is unreadable', null],
    ])('shows no mark for %s', async (_name, flavor) => {
        const { Avatar } = await import('./Avatar');

        const tree = await renderAvatar(<Avatar id="session-1" flavor={flavor} size={48} />);

        expect(tree.findAllByType('SvgXml' as any)).toEqual([]);
        expect(tree.findAllByType('Image' as any)).toEqual([]);
    });

    it('still shows the unread badge for an Agent with no mark', async () => {
        const { Avatar } = await import('./Avatar');

        const tree = await renderAvatar(
            <Avatar
                id="session-1"
                flavor="acme.agent/custom-agent"
                size={48}
                hasUnreadMessages
                unreadBadgeTestID="unread-badge"
            />,
        );

        expect(tree.root.findAllByProps({ testID: 'unread-badge' }).length).toBeGreaterThan(0);
        expect(tree.findAllByType('SvgXml' as any)).toEqual([]);
    });

    it('overlays the bundled Agent’s mark on an uploaded image', async () => {
        const { Avatar } = await import('./Avatar');

        const tree = await renderAvatar(
            <Avatar
                id="session-1"
                flavor="claude"
                imageUrl="https://example.com/avatar.png"
                size={48}
            />,
        );

        expect(tree.findAllByType('SvgXml' as any).length).toBe(1);
    });

    it('keeps the uploaded image unmarked when the Agent has no mark', async () => {
        const { Avatar } = await import('./Avatar');

        const tree = await renderAvatar(
            <Avatar
                id="session-1"
                flavor="acme.agent/custom-agent"
                imageUrl="https://example.com/avatar.png"
                size={48}
            />,
        );

        expect(tree.findAllByType('SvgXml' as any)).toEqual([]);
    });
});
