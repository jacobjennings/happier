import { describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook } from '@/dev/testkit';
import { useTerminalSurfaceState } from './useTerminalSurfaceState';

describe('terminal retained-output facts', () => {
    it('publishes only changed bounds and retains the exact terminal facts across remounts', async () => {
        const params = { terminalKey: 'FX211-retention', terminalRef: { current: null },
            terminalIdRef: { current: 'terminal' as string | null }, cursorRef: { current: 0 },
            terminalRendererHandleRef: { current: null }, clearNonceRef: { current: 0 } };
        let renders = 0;
        const hook = await renderHook(() => { renders += 1; return useTerminalSurfaceState(params); });
        expect(hook.getCurrent()).toHaveProperty('syncOutputRetention', expect.any(Function));
        const retention = { mode: 'byte-offset', retainedFromCursor: 100, availableCursor: 2500, truncated: true } as const;
        await act(async () => hook.getCurrent().syncOutputRetention('terminal', retention));
        expect(hook.getCurrent().outputRetention).toEqual({ terminalId: 'terminal', value: retention });
        const settledRenders = renders;
        await act(async () => {
            for (let index = 0; index < 100; index += 1) hook.getCurrent().syncOutputRetention('terminal', { ...retention });
        });
        expect(renders).toBe(settledRenders);
        await act(async () => hook.getCurrent().syncOutputRetention('terminal', { ...retention, availableCursor: 3000 }));
        expect(hook.getCurrent().outputRetention?.value.availableCursor).toBe(3000);
        await hook.unmount();
        const reopened = await renderHook(() => useTerminalSurfaceState(params));
        expect(reopened.getCurrent().outputRetention?.value).toMatchObject({ availableCursor: 3000, truncated: true });
        await act(async () => reopened.getCurrent().syncOutputRetention('replacement', null));
        expect(reopened.getCurrent().outputRetention).toBeNull();
        await reopened.unmount();
    });
});
