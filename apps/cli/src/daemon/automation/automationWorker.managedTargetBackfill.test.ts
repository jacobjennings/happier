import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { DEFAULT_AUTOMATION_V3_MAX_ACTIVE_RUNS_PER_MACHINE,
    AutomationDefinitionListItemSchema } from '@happier-dev/protocol/automations/automationApiV3';
import { reloadConfiguration } from '@/configuration';
import type { StoredCredentials } from '@/persistence';
import { startAutomationWorker } from './automationWorker';

const credentialStore = vi.hoisted(() => ({ current: null as StoredCredentials | null }));
vi.mock('@/persistence', async importOriginal => ({ ...await importOriginal<typeof import('@/persistence')>(),
    readStoredCredentials: async () => credentialStore.current }));
afterEach(() => { vi.unstubAllEnvs(); reloadConfiguration(); });

async function harness(hold = false) {
    let selections = 0;
    let detailReads = 0;
    let selected: ServerResponse | undefined;
    const summary = AutomationDefinitionListItemSchema.parse({ id: 'legacy-unindexed', name: 'retained',
        description: null, enabled: true, targetType: null, existingSessionId: null, templateVersion: 1,
        lastRunAt: null, createdAt: 1, updatedAt: 1, assignments: [], triggers: [] });
    const server = createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json');
        const url = new URL(request.url ?? '/', 'http://fixture');
        if (url.pathname === '/v3/automations/query') {
            let body = '';
            request.on('data', chunk => { body += String(chunk); });
            request.on('end', () => {
                if (JSON.parse(body).managedTargetUnindexed === true) selections++;
                selected = response;
                if (!hold) response.end(JSON.stringify({ automations: [], nextCursor: null }));
            });
        } else if (url.pathname === '/v3/automations') {
            if (url.searchParams.get('managedTargetUnindexed') === 'true') selections++;
            selected = response;
            if (!hold) response.end(JSON.stringify({ automations: [], nextCursor: null }));
        } else if (url.pathname.startsWith('/v3/automations/worker/assignments')) {
            response.end(JSON.stringify({ assignments: [], settings: { maxActiveRunsPerMachine: DEFAULT_AUTOMATION_V3_MAX_ACTIVE_RUNS_PER_MACHINE } }));
        } else if (url.pathname.endsWith('/worker/run-lifecycle')) response.end(JSON.stringify({ sources: [] }));
        else if (url.pathname === '/v3/automations/runs/claim') response.end(JSON.stringify({ run: null, automation: null, accountCurrentness: null }));
        else if (url.pathname === '/v3/automations/legacy-unindexed') { detailReads++; response.statusCode = 404; response.end('{}'); }
        else { response.statusCode = 404; response.end('{}'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected loopback HTTP boundary');
    vi.stubEnv('HAPPIER_SERVER_URL', `http://127.0.0.1:${address.port}`);
    vi.stubEnv('HAPPIER_WEBAPP_URL', `http://127.0.0.1:${address.port}`);
    reloadConfiguration();
    const credentials = { token: 'backfill-test-credential', encryption: null };
    credentialStore.current = credentials;
    const worker = startAutomationWorker({ credentials, token: credentials.token, machineId: 'backfill-machine' });
    return { worker, selections: () => selections, detailReads: () => detailReads,
        selectionClosed: () => selected?.destroyed === true,
        release: () => { selected?.end(JSON.stringify({ automations: [summary], nextCursor: null })); },
        async close() {
            worker.stop(); selected?.end(JSON.stringify({ automations: [], nextCursor: null }));
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        } };
}

describe('Automation worker one-shot managed target migration', () => {
    it('runs once at startup and stays settled through reconnect catch-up and unrelated arrivals', async () => {
        const owner = await harness();
        try {
            await vi.waitFor(() => expect(owner.selections()).toBe(1));
            await owner.worker.refreshAssignments();
            await owner.worker.catchUp();
            owner.worker.pause(); owner.worker.resume();
            for (let index = 0; index < 12; index++) owner.worker.handleServerUpdate({ id: `u${index}`, seq: index,
                createdAt: 1, body: { t: 'automation-delete', automationId: `other-${index}`, deletedAt: 1 } });
            await owner.worker.refreshAssignments();
            expect(owner.selections()).toBe(1);
        } finally { await owner.close(); }
    });

    it.each(['stop', 'credentials'] as const)('fences a held startup response after %s retirement', async retirement => {
        const owner = await harness(true);
        try {
            await vi.waitFor(() => expect(owner.selections()).toBe(1));
            if (retirement === 'stop') {
                expect(owner.selectionClosed()).toBe(false);
                owner.worker.stop();
                await vi.waitFor(() => expect(owner.selectionClosed()).toBe(true));
            } else credentialStore.current = null;
            owner.release();
            await owner.worker.refreshAssignments();
            await new Promise<void>(resolve => setTimeout(resolve, 25));
            expect(owner.detailReads()).toBe(0);
        } finally { await owner.close(); }
    });
});
