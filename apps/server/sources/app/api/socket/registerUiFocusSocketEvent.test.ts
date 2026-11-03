import type { Socket } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import { registerUiFocusSocketEvent } from "@/app/api/socket/registerUiFocusSocketEvent";

describe("ui-focus admission", () => {
    it('records focus transitions on the existing push without refreshing repeated facts or blur', () => {
        let onFocus!: (input: unknown) => void;
        const fixture = { connected: true, data: { clientType: 'user-scoped', clientPurpose: 'sync' } as Record<string, unknown>,
            on: (_event: string, listener: typeof onFocus) => { onFocus = listener; } };
        registerUiFocusSocketEvent(fixture as unknown as Socket);
        const clock = vi.spyOn(Date, 'now');
        try {
            clock.mockReturnValue(10);
            onFocus({ computer: true, focused: true });
            expect(fixture.data.uiLastFocusedAt).toBe(10);
            clock.mockReturnValue(20);
            onFocus({ computer: true, focused: true });
            onFocus({ computer: true, focused: false });
            expect(fixture.data.uiLastFocusedAt).toBe(10);
            onFocus({ computer: true, focused: true });
            expect(fixture.data.uiLastFocusedAt).toBe(20);
        } finally { clock.mockRestore(); }
    });
    it.each(["ready", "revoked", "disconnected"] as const)("waits for final authentication admission: %s", async (outcome) => {
        let finishAdmission!: (admitted: boolean) => void;
        const admission = new Promise<boolean>((resolve) => { finishAdmission = resolve; });
        let onFocus!: (input: unknown, ack?: (response: { ok: boolean }) => void) => void;
        const fixture = {
            connected: true,
            data: { clientType: "user-scoped", clientPurpose: "sync" } as Record<string, unknown>,
            on: vi.fn((_event: string, listener: typeof onFocus) => { onFocus = listener; }),
        };
        // Boundary fixture: this listener uses only Socket.IO connection state, data and event registration.
        const register: (socket: Socket, admission: Promise<boolean>) => void = registerUiFocusSocketEvent;
        register(fixture as unknown as Socket, admission);
        const acknowledge = vi.fn();
        onFocus({ computer: true, focused: true }, acknowledge);
        expect(fixture.data.uiFocus).toBeUndefined();
        expect(acknowledge).not.toHaveBeenCalled();
        if (outcome === "disconnected") fixture.connected = false;
        finishAdmission(outcome !== "revoked");
        await admission;
        expect(acknowledge).toHaveBeenCalledWith({ ok: outcome === "ready" });
        expect(fixture.data.uiFocus).toEqual(outcome === "ready" ? { computer: true, focused: true } : undefined);
    });
});
