import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeBase64 } from 'privacy-kit';
import { encodePlainMachineStoredContent, MACHINE_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';
import { db, getDbProviderFromEnv, initDbPostgres } from '@/storage/db';
import { inTx, type Tx } from '@/storage/inTx';
import { setMachineAccessGrantInTx, removeMachineAccessGrantInTx } from '@/app/machines/machineAccess';
import { observePrismaReads } from '@/testkit/observePrismaReads';
import { createSessionPublisherPresence } from './sessionPublisherPresence';

describe.skipIf(getDbProviderFromEnv(process.env, 'postgres') !== 'postgres')('Machine terminal custody (PostgreSQL)', () => {
    let connected = false;
    beforeAll(async () => {
        if (!process.env.HAPPIER_TEST_POSTGRES_DATABASE_URL
            || process.env.DATABASE_URL !== process.env.HAPPIER_TEST_POSTGRES_DATABASE_URL) {
            throw new Error('Use the disposable PostgreSQL DB-contract harness');
        }
        vi.stubEnv('HAPPIER_SERVER_IDENTITY_ID', `srv_${randomUUID().replaceAll('-', '')}`);
        vi.stubEnv('HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY', 'optional');
        initDbPostgres();
        await db.$connect();
        connected = true;
    });
    afterAll(async () => {
        if (connected) await db.$disconnect();
        vi.unstubAllEnvs();
    });

    it('retires the exact foreign publisher after requester grant loss without rereading requester keys', async () => {
        const custodian = await db.account.create({ data: { encryptionMode: 'plain' } });
        const requester = await db.account.create({ data: { encryptionMode: 'plain' } });
        const installationId = randomUUID();
        const machine = await db.machine.create({ data: { id: randomUUID(), accountId: custodian.id, installationId,
            metadata: encodePlainMachineStoredContent({ host: 'terminal-host', platform: 'linux', happyCliVersion: 'test',
                homeDir: '/home/test', happyHomeDir: '/home/test/.happier' }),
            dataEncryptionKey: decodeBase64(MACHINE_PLAIN_DATA_KEY_MARKER) } });
        const session = await db.session.create({ data: { accountId: requester.id, tag: randomUUID(), metadata: '{}', active: false } });
        const requesterBinding = { accountId: requester.id, machineId: machine.id, sessionId: session.id };
        expect(await inTx(tx => setMachineAccessGrantInTx(tx, { actorAccountId: custodian.id, machineId: machine.id,
            principal: { kind: 'account', accountId: requester.id }, level: 'view' }))).toMatchObject({ kind: 'saved' });
        await db.accessKey.create({ data: { ...requesterBinding, data: 'opaque' } });
        const presence = createSessionPublisherPresence();
        const registered = await presence.registerPublisher({ socket: {}, binding: requesterBinding,
            completeActivitySnapshot: { state: 'active', activeCount: 1 } });
        expect(registered, JSON.stringify(registered, (_key, value) => typeof value === 'bigint' ? String(value) : value))
            .toMatchObject({ status: 'registered' });
        await inTx(tx => removeMachineAccessGrantInTx(tx, { actorAccountId: custodian.id, machineId: machine.id,
            principal: { kind: 'account', accountId: requester.id } }));

        const originalTransaction = db.$transaction;
        const reads: string[] = [];
        db.$transaction = new Proxy(originalTransaction, { apply(target, receiver, args: unknown[]) {
            const callback = args[0];
            if (typeof callback !== 'function') return Reflect.apply(target, receiver, args);
            return Reflect.apply(target, receiver, [async (tx: Tx) => {
                const observed = observePrismaReads(tx, ['session', 'accessKey']);
                try { return await callback(observed.tx); } finally { reads.push(...observed.reads); }
            }, ...args.slice(1)]);
        } });
        const captured = await (async () => {
            try {
                return await presence.captureMachineSessionTerminal({
                    binding: { ...requesterBinding, accountId: custodian.id }, installedMachineCustody: { installationId },
                });
            } finally { db.$transaction = originalTransaction; }
        })();
        expect(captured.status).toBe('captured');
        // The narrow process fact reads one exact Session and never reacquires requester keys.
        expect(reads.filter(read => read.startsWith('session.'))).toHaveLength(1);
        expect(reads.some(read => read.startsWith('accessKey.'))).toBe(false);
        if (captured.status !== 'captured') throw new Error('expected installed host capture');
        expect(await presence.finalizeMachineSessionTerminal({ target: captured.target,
            installedMachineCustody: { installationId } })).toMatchObject({ status: 'closed' });
        expect(await db.session.findUniqueOrThrow({ where: { id: session.id }, select: {
            active: true, publisherGenerationLastActiveAt: true,
        } })).toEqual({ active: false, publisherGenerationLastActiveAt: null });
    });
});
