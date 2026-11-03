import Fastify from "fastify";
import { Server } from "socket.io";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionConsumptionReplaceAckV1Schema } from "@happier-dev/protocol";
import { UpdateContainerSchema } from "@happier-dev/protocol/updates";
import { startSocket } from "@/app/api/socket";
import type { Fastify as AppFastify } from "@/app/api/types";
import { auth } from "@/app/auth/auth";
import { buildMessageUpdatedUpdate, buildNewMessageUpdate, eventRouter } from "@/app/events/eventRouter";
import { deleteSessionAccessGrantInTx, putSessionAccessGrantInTx } from "@/app/session/access/sessionAccessGrantService";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

describe("Session consumption through authenticated Socket.IO registration and SQLite", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-session-consumption-", initAuth: true, initEncrypt: true,
            env: { AUTH_REQUIRED_LOGIN_PROVIDERS: "", HAPPIER_SOCKET_ADAPTER: "memory" } });
    }, 120_000);
    afterAll(async () => { await harness?.close(); });

    it("replaces demand, isolates devices, survives reconnect and rechecks revoked access before hints or bodies", async () => {
        const [owner, viewer, stranger] = await Promise.all(Array.from({ length: 3 }, () => db.account.create({
            data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" },
        })));
        const [session, denied] = await Promise.all([owner, stranger].map(account => db.session.create({ data: {
            accountId: account.id, tag: crypto.randomUUID(), metadata: "{}", encryptionMode: "plain",
        } })));
        const authentication = { env: process.env, authority: "present_user" as const, authenticationEvidence: [] };
        await db.userRelationship.create({ data: { fromUserId: owner.id, toUserId: viewer.id, status: "friend" } });
        expect(await inTx(tx => putSessionAccessGrantInTx(tx, {
            actorAccountId: owner.id, sessionId: session.id, subject: { kind: "account", accountId: viewer.id },
            grant: { accessLevel: "view", canApprovePermissions: false }, authentication,
        }))).toMatchObject({ ok: true });
        const app = Fastify({ logger: false }) as unknown as AppFastify;
        startSocket(app);
        const io = app.machineDaemonPresence;
        if (!(io instanceof Server)) throw new Error("Missing Socket.IO server");
        await app.listen({ port: 0, host: "127.0.0.1" });
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("Missing socket address");
        const clients: ClientSocket[] = [];
        const updates = new Map<ClientSocket, unknown[]>();
        const ticks = new Map<ClientSocket, unknown[]>();
        const open = async (accountId: string, clientPurpose: string, runner = false) => {
            const token = await auth.createToken(accountId, undefined, { kind: "account", authority: "present_user" });
            const client = connect(`http://127.0.0.1:${address.port}`, {
                path: "/v1/updates", transports: ["websocket"], reconnection: false, autoConnect: false,
                auth: { token, clientPurpose, clientType: runner ? "session-scoped" : "user-scoped",
                    ...(runner ? { sessionId: session.id } : {}) },
            });
            clients.push(client);
            updates.set(client, []);
            ticks.set(client, []);
            client.on("update", value => {
                const parsed = UpdateContainerSchema.parse(value);
                if (parsed.body.t === "new-message" || parsed.body.t === "message-updated") updates.get(client)!.push(parsed);
            });
            client.on("ephemeral", value => {
                if (value.type === "transcript-stream-segment" || value.type === "transcript-stream-segment-delta") ticks.get(client)!.push(value);
            });
            await new Promise<void>((resolve, reject) => {
                client.once("connect", resolve); client.once("connect_error", reject); client.connect();
            });
            // Use the same ACK boundary as the real client to wait for connect convergence.
            await client.timeout(7_500).emitWithAck("ping");
            return client;
        };
        const replace = async (client: ClientSocket, liveSessionIds: string[], durableSessionIds: string[]) =>
            SessionConsumptionReplaceAckV1Schema.parse(await client.timeout(7_500).emitWithAck(
                "session-consumption-replace", { v: 1, liveSessionIds, durableSessionIds },
            ));
        const settle = async () => {
            await Promise.all(clients.filter(client => client.connected).map(client => client.timeout(7_500).emitWithAck("ping")));
        };
        const message = { id: "message", seq: 1, localId: null, content: { t: "encrypted" as const, c: "private-content" },
            createdAt: new Date(1), updatedAt: new Date(2) };
        const publish = async (accountId: string, revision = false) => eventRouter.emitUpdate({ userId: accountId,
            payload: (revision ? buildMessageUpdatedUpdate : buildNewMessageUpdate)(message, session.id, revision ? 2 : 1, crypto.randomUUID()),
            recipientFilter: { type: "all-interested-in-session", sessionId: session.id },
        });
        try {
            const hidden = await open(owner.id, "sync");
            const live = await open(owner.id, "sync");
            const durable = await open(owner.id, "concurrent-server-cache");
            const runner = await open(owner.id, "sdk-live", true);
            const shared = await open(viewer.id, "sync");
            expect(await replace(live, [session.id, denied.id, "missing"], []))
                .toEqual({ ok: true, v: 1, liveSessionIds: [session.id], durableSessionIds: [] });
            expect(await replace(durable, [], [session.id]))
                .toEqual({ ok: true, v: 1, liveSessionIds: [], durableSessionIds: [session.id] });
            expect(await replace(shared, [session.id], []))
                .toEqual({ ok: true, v: 1, liveSessionIds: [session.id], durableSessionIds: [] });
            await publish(owner.id);
            await publish(owner.id, true);
            for (const type of ["transcript-stream-segment", "transcript-stream-segment-delta"] as const) {
                await eventRouter.emitEphemeral({ userId: owner.id,
                    payload: { type, sessionId: session.id, message: { localId: "segment", tick: 2, baseLength: 1,
                        content: { t: "encrypted", c: "private-tick" }, createdAt: 1, updatedAt: 2 } },
                    recipientFilter: { type: "all-interested-in-session", sessionId: session.id },
                });
            }
            await settle();
            expect(updates.get(hidden)).toEqual(["new-message", "message-updated"].map(t => expect.objectContaining({
                body: expect.objectContaining({ t, delivery: "hint", message: expect.not.objectContaining({ content: expect.anything() }) }),
            })));
            for (const client of [live, durable, runner]) expect(updates.get(client)).toHaveLength(2);
            for (const client of [live, durable, runner]) for (const update of updates.get(client)!) expect(update).toMatchObject({
                body: { delivery: "full", message: { content: message.content } },
            });
            expect(ticks.get(hidden)).toHaveLength(0);
            expect(ticks.get(durable)).toHaveLength(0);
            expect(ticks.get(live)).toHaveLength(2);
            expect(ticks.get(runner)).toHaveLength(2);

            await replace(live, [], []);
            await publish(owner.id, true);
            await settle();
            expect(updates.get(live)!.at(-1)).toMatchObject({ body: { delivery: "hint", message: { id: "message", seq: 1 } } });
            live.disconnect();
            const reconnected = await open(owner.id, "sync");
            await publish(owner.id);
            await settle();
            expect(updates.get(reconnected)).toMatchObject([{ body: { delivery: "hint" } }]);

            await publish(viewer.id);
            await settle();
            expect(updates.get(shared)).toHaveLength(1);
            expect(await inTx(tx => deleteSessionAccessGrantInTx(tx, { actorAccountId: owner.id,
                sessionId: session.id, subject: { kind: "account", accountId: viewer.id }, authentication })))
                .toMatchObject({ ok: true });
            await publish(viewer.id, true);
            await settle();
            expect(updates.get(shared)).toHaveLength(1);
            expect(await replace(shared, [session.id], []))
                .toEqual({ ok: true, v: 1, liveSessionIds: [], durableSessionIds: [] });
        } finally {
            clients.forEach(client => client.disconnect());
            eventRouter.clearIo();
            await io.close();
            await app.close();
        }
    }, 60_000);
});
