import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc/methods';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpcErrors';
import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { eventRouter } from '@/app/events/connectionEventRouter';
import { createSocketRoomDiscoveryHarness } from '@/app/api/testkit/socketHarness';
import { forwardRpcCall } from '@/app/api/socket/rpc/forwardRpcCall';
import { dispatchMachineAccessLossCustody } from './machineAccessCustody';

describe('Machine grant withdrawal through requester runtime custody', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: 'happier-requester-custody-', initEncrypt: false, initFiles: false });
    }, 120_000);
    afterAll(async () => { if (harness) await harness.close(); });

    it.each([
        ['admission', 'admission_refused:machine_unavailable'],
        ['admission-at-guard', 'admission_refused:machine_unavailable'],
        ['installation', 'installation_mismatch'],
        ['target-installation', 'installation_mismatch'],
        ['missing-target', 'target_not_found'],
        ['missing-forwarder', 'forwarder_unavailable'],
        ['disconnected-target', `forward_failed:${RPC_ERROR_CODES.OUTCOME_UNKNOWN}`],
        ['uncoded-transport', 'forward_failed:unknown'],
        ['failed-discovery', `forward_failed:${RPC_ERROR_CODES.TRANSPORT_UNAVAILABLE}`],
        ['invalid-response', 'response_invalid'],
        ['daemon-refusal', `forward_failed:${RPC_ERROR_CODES.FORBIDDEN}`],
        ['incomplete-response', 'cleanup_incomplete'],
    ] as const)('retains the content-free custody reason for %s', async (scenario, reason) => {
        const owner = await db.account.create({ data: {} });
        const requester = await db.account.create({ data: {} });
        const machine = await db.machine.create({ data: { id: randomUUID(), accountId: owner.id,
            active: scenario !== 'admission', metadata: 'encrypted-metadata', installationId: randomUUID() } });
        const input = { machineId: machine.id, subjectAccountId: requester.id, expectedCustodianAccountId: owner.id,
            expectedInstallationId: scenario === 'installation' ? randomUUID() : machine.installationId! };
        const method = `${machine.id}:${RPC_METHODS.DAEMON_MACHINE_ACCESS_LOSS}`;
        const target = { id: 'diagnostic-daemon', data: { clientType: 'machine-scoped', userId: owner.id,
            machineId: machine.id, verifiedMachineInstallationId: scenario === 'target-installation' ? randomUUID() : machine.installationId },
            timeout: () => ({ emitWithAck: async () => {
                if (scenario === 'disconnected-target') throw Object.assign(new Error('private transport detail'), { code: 'SOCKET_DISCONNECTED' });
                if (scenario === 'uncoded-transport') throw new Error('private transport detail');
                if (scenario === 'invalid-response') return { kind: 'settled', privateData: 'must not escape' };
                if (scenario === 'daemon-refusal') return { error: 'private refusal detail', errorCode: RPC_ERROR_CODES.FORBIDDEN };
                return { kind: scenario === 'incomplete-response' ? 'incomplete' : 'settled' };
            } }) };
        const io = createSocketRoomDiscoveryHarness(async room => {
            if (scenario === 'failed-discovery') throw new Error('private discovery detail');
            if (scenario === 'admission-at-guard' && room === target.id) {
                await db.machine.update({ where: { id: machine.id }, data: { active: false } });
            }
            return scenario !== 'missing-target' && (room === target.id || room === `rpc:${owner.id}:${method}`) ? [target] : [];
        });
        eventRouter.setIo(io, scenario === 'missing-forwarder' ? {} : { forwardRpc: request => forwardRpcCall({ io, ...request }) });
        try {
            expect(await dispatchMachineAccessLossCustody(input)).toEqual({ kind: 'incomplete', reason });
        } finally { eventRouter.clearIo(); }
    });

});
