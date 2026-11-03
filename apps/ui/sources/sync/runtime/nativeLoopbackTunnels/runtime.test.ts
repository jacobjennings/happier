import { describe, expect, it, vi } from 'vitest';

import { bindNativeLoopbackTunnelRuntimeActivity } from './runtime';

describe('native loopback tunnel runtime activity', () => {
    it('drives every native loopback runtime from one provider-neutral activity owner', async () => {
        let active = true;
        let listener: (() => void | Promise<void>) | null = null;
        const unsubscribe = vi.fn();
        const runtimes = [
            { markSuspended: vi.fn(), markForeground: vi.fn(async () => undefined) },
            { markSuspended: vi.fn(), markForeground: vi.fn(async () => undefined) },
            { markSuspended: vi.fn(), markForeground: vi.fn(async () => undefined) },
        ];

        const lifecycle = bindNativeLoopbackTunnelRuntimeActivity({
            isActive: () => active,
            subscribe: (nextListener) => {
                listener = nextListener;
                return unsubscribe;
            },
            runtimes,
        });
        const emitActivityChange = async (nextActive: boolean) => {
            active = nextActive;
            const currentListener = listener;
            if (!currentListener) throw new Error('Runtime-activity listener was not registered');
            await currentListener();
        };

        await emitActivityChange(false);
        for (const runtime of runtimes) expect(runtime.markSuspended).toHaveBeenCalledTimes(1);

        await emitActivityChange(true);
        for (const runtime of runtimes) expect(runtime.markForeground).toHaveBeenCalledTimes(1);

        lifecycle.remove();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('attempts foreground recovery for every runtime when one runtime fails', async () => {
        let active = false;
        const listenerRef: { current: (() => void | Promise<void>) | null } = { current: null };
        const failingRuntime = {
            markSuspended: vi.fn(),
            markForeground: vi.fn(async () => {
                throw new Error('foreground recovery failed');
            }),
        };
        const healthyRuntime = {
            markSuspended: vi.fn(),
            markForeground: vi.fn(async () => undefined),
        };
        const lifecycle = bindNativeLoopbackTunnelRuntimeActivity({
            isActive: () => active,
            subscribe: (nextListener) => {
                listenerRef.current = nextListener;
                return () => undefined;
            },
            runtimes: [failingRuntime, healthyRuntime],
        });
        const currentListener = listenerRef.current;
        if (!currentListener) throw new Error('Runtime-activity listener was not registered');

        active = true;
        await expect(currentListener()).resolves.toBeUndefined();
        expect(failingRuntime.markForeground).toHaveBeenCalledTimes(1);
        expect(healthyRuntime.markForeground).toHaveBeenCalledTimes(1);

        lifecycle.remove();
    });
});
