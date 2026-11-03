import { describe, expect, it } from 'vitest';
import { createApiProjectAccountRowsTransport } from './apiProjectAccountRows';

describe('Project row authoring metadata negotiation', () => {
    it('requests ids explicitly, falls back once on a legacy schema refusal, and remembers that server for later demand', async () => {
        const bodies: unknown[] = [];
        const transport = createApiProjectAccountRowsTransport({ request: async (_path, init) => {
            const body: unknown = JSON.parse(String(init?.body));
            bodies.push(body);
            if (body && typeof body === 'object' && 'includeAuthoringSession' in body) {
                return Response.json({ error: 'invalid-params' }, { status: 400 });
            }
            return Response.json({ status: 'listed', coverage: 'complete', rows: [] });
        } });
        expect(await transport.list()).toMatchObject({ status: 'listed', rows: [] });
        expect(await transport.list()).toMatchObject({ status: 'listed', rows: [] });
        expect(bodies).toEqual([{ includeAuthoringSession: true }, {}, {}]);
    });

    it('propagates unrelated refusals without downgrading to an unrestricted read', async () => {
        let reads = 0;
        const transport = createApiProjectAccountRowsTransport({ request: async () => {
            reads++;
            return Response.json({ error: 'forbidden' }, { status: 403 });
        } });
        await expect(transport.list()).rejects.toThrow();
        expect(reads).toBe(1);
    });
});
