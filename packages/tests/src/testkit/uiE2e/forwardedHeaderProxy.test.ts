import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER } from '@happier-dev/protocol/clientCompatibility/accountStoredContentCompatibilityV1';

import { startForwardedHeaderProxy } from './forwardedHeaderProxy';

describe('startForwardedHeaderProxy', () => {
    it('preserves upstream preflight approval and denial instead of defining another CORS policy', async () => {
        const origin = 'http://127.0.0.1:12345';
        // Genuine HTTP boundary: the upstream owns which request headers it accepts.
        const upstream = createServer((req, res) => {
            expect(req.method).toBe('OPTIONS');
            expect(req.headers.origin).toBe(origin);
            expect(req.headers['x-fixture-identity']).toBe('disposable-account');
            if (req.headers['access-control-request-headers'] !== ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER) {
                res.writeHead(403);
                res.end();
                return;
            }
            res.writeHead(204, {
                'access-control-allow-origin': origin,
                'access-control-allow-methods': 'POST',
                'access-control-allow-headers': ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER,
            });
            res.end();
        });
        upstream.listen(0, '127.0.0.1');
        await once(upstream, 'listening');
        const address = upstream.address();
        if (!address || typeof address !== 'object') throw new Error('Upstream did not listen');
        const proxy = await startForwardedHeaderProxy({
            targetBaseUrl: `http://127.0.0.1:${address.port}`,
            identityHeaders: { 'x-fixture-identity': 'disposable-account' },
        });
        try {
            const allowed = await fetch(proxy.baseUrl + '/v1/auth/entry', {
                method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST',
                    'access-control-request-headers': ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER },
            });
            expect(allowed.status).toBe(204);
            expect(allowed.headers.get('access-control-allow-headers')).toBe(ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER);
            expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
            expect(allowed.headers.get('access-control-allow-methods')).toBe('POST');
            const denied = await fetch(proxy.baseUrl + '/v1/auth/entry', {
                method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST',
                    'access-control-request-headers': 'x-unapproved-fixture-header' },
            });
            expect(denied.status).toBe(403);
            expect(denied.headers.get('access-control-allow-headers')).toBeNull();
        } finally {
            await proxy.stop();
            await new Promise<void>(resolve => upstream.close(() => resolve()));
        }
    });
});
