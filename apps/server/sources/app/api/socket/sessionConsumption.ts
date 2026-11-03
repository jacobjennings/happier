import type { Socket } from "socket.io";
import { SessionConsumptionReplaceV1Schema, type SessionConsumptionReplaceAckV1 } from "@happier-dev/protocol";
import { resolveSessionAccessForOperation } from "@/app/session/access/sessionAccess";
import { readSessionAccessAuthenticationFromSocket } from "@/app/session/access/sessionAccessAuthentication";
import { readSnapshotWithCurrentAdmission } from "@/storage/readSnapshotWithCurrentAdmission";
import type { Tx } from "@/storage/inTx";
import { log } from "@/utils/logging/log";

interface SessionSocketConsumption {
    liveSessionIds: ReadonlySet<string>;
    durableSessionIds: ReadonlySet<string>;
}

function isUiConsumptionSocket(data: Socket["data"]): boolean {
    return data.clientType === "user-scoped"
        && (data.clientPurpose === "sync" || data.clientPurpose === "concurrent-server-cache");
}

/** Audience admission is separate: this only selects delivery for an admitted socket. */
export function readSessionSocketConsumption(data: Socket["data"], sessionId: string): {
    durableBodies: boolean;
    liveSegments: boolean;
} {
    // The pooled UI RPC carrier has no transcript consumer or declaration.
    if (data.clientType === "user-scoped" && data.clientPurpose === "scoped-rpc") {
        return { durableBodies: false, liveSegments: false };
    }
    if (!isUiConsumptionSocket(data)) return { durableBodies: true, liveSegments: true };
    const consumption: SessionSocketConsumption | undefined = data.sessionConsumption;
    const liveSegments = consumption?.liveSessionIds.has(sessionId) === true;
    return { liveSegments, durableBodies: liveSegments || consumption?.durableSessionIds.has(sessionId) === true };
}

/** A replace belongs to this authenticated socket and expires with its transport. */
export function registerSessionConsumptionSocketEvent(socket: Socket, admission: Promise<boolean>): void {
    let pending = Promise.resolve();
    socket.on("session-consumption-replace", (input: unknown, acknowledge: unknown) => {
        const reply = (result: SessionConsumptionReplaceAckV1) => {
            if (typeof acknowledge === "function") acknowledge(result);
        };
        const parsed = SessionConsumptionReplaceV1Schema.safeParse(input);
        if (!parsed.success) { reply({ ok: false, error: "invalid_request" }); return; }
        // Preserve the socket's packet order across asynchronous access reads.
        pending = pending.then(async () => {
            if (!(await admission) || !socket.connected || !isUiConsumptionSocket(socket.data)) {
                reply({ ok: false, error: "not_allowed" });
                return;
            }
            const accountId = socket.data.userId;
            const requested = [...new Set([...parsed.data.liveSessionIds, ...parsed.data.durableSessionIds])];
            const authorize = async (tx: Tx, ids: readonly string[]) => {
                const admitted: string[] = [];
                for (const sessionId of ids) {
                    const decision = await resolveSessionAccessForOperation(tx, {
                        accountId, sessionId, capability: "readTranscript",
                        authentication: readSessionAccessAuthenticationFromSocket(socket),
                    });
                    if (decision.status === "allowed") admitted.push(sessionId);
                }
                return admitted;
            };
            const admitted = new Set(await readSnapshotWithCurrentAdmission(
                tx => authorize(tx, requested),
                (tx, captured) => authorize(tx, captured),
            ));
            if (!socket.connected || !isUiConsumptionSocket(socket.data) || socket.data.userId !== accountId) {
                reply({ ok: false, error: "not_allowed" });
                return;
            }
            const liveSessionIds = [...new Set(parsed.data.liveSessionIds)].filter(id => admitted.has(id));
            const durableSessionIds = [...new Set(parsed.data.durableSessionIds)].filter(id => admitted.has(id));
            socket.data.sessionConsumption = {
                liveSessionIds: new Set(liveSessionIds), durableSessionIds: new Set(durableSessionIds),
            } satisfies SessionSocketConsumption;
            reply({ ok: true, v: 1, liveSessionIds, durableSessionIds });
        }).catch(error => {
            log({ module: "session-consumption", error }, "Session consumption declaration unavailable");
            reply({ ok: false, error: "unavailable" });
        });
    });
}
