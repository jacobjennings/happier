import { describe, expect, it, vi } from 'vitest';

import type { RelayHostLocalChecklistRuntimeStatus } from './types';
import { buildRelayHostLocalChecklistItems } from './buildRelayHostLocalChecklistItems';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

describe('buildRelayHostLocalChecklistItems', () => {
    it('marks missing relay runtime items as recommended and keeps secure access hidden until the runtime is installed', () => {
        const status: RelayHostLocalChecklistRuntimeStatus = {
            installed: false,
            version: null,
            relayUrl: 'http://localhost:53288',
            healthy: false,
            service: { active: false, enabled: false },
        };

        const items = buildRelayHostLocalChecklistItems({
            runtimeStatus: status,
        });

        expect(items).toHaveLength(2);
        expect(items[0]?.id).toBe('installRelayRuntime');
        expect(items[0]?.defaultSelected).toBe(true);
        expect(items[0]?.satisfied).toBe(false);
        expect(items[1]?.id).toBe('startRelayRuntime');
        expect(items[1]?.defaultSelected).toBe(true);
    });

    it('marks install and start satisfied once the relay runtime is installed, running and healthy', () => {
        const status: RelayHostLocalChecklistRuntimeStatus = {
            installed: true,
            version: '1.2.3',
            relayUrl: 'http://localhost:53288',
            healthy: true,
            service: { active: true, enabled: true },
        };

        const items = buildRelayHostLocalChecklistItems({
            runtimeStatus: status,
        });

        expect(items).toHaveLength(2);
        expect(items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'installRelayRuntime',
                satisfied: true,
                disabled: true,
                defaultSelected: false,
            }),
            expect.objectContaining({
                id: 'startRelayRuntime',
                satisfied: true,
                disabled: true,
                defaultSelected: false,
            }),
        ]));
    });
});
