import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNpmRegistryProfileProbe } from './probe';

// The probe runs the real npm registry client beneath these DNS and HTTPS boundaries.
const network = vi.hoisted(() => ({
  requests: [] as RequestOptions[],
  reply: null as null | (() => Readonly<{ statusCode: number; body: string }> | Error),
}));
vi.mock('node:dns/promises', async (original) => ({
  ...await original<typeof import('node:dns/promises')>(),
  // A private answer: only the profile's private-network policy admits it.
  lookup: async () => [{ address: '10.0.0.5', family: 4 }],
}));
vi.mock('node:https', async (original) => {
  const actual = await original<typeof import('node:https')>();
  const request = (options: RequestOptions, callback: (message: IncomingMessage) => void) => {
    network.requests.push(options);
    const emitter = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void; destroy: (error?: Error) => void };
    emitter.setTimeout = () => undefined;
    emitter.destroy = (error?: Error) => { if (error) emitter.emit('error', error); };
    emitter.end = () => queueMicrotask(() => {
      const outcome = network.reply!();
      if (outcome instanceof Error) {
        emitter.emit('error', outcome);
        return;
      }
      const message = Readable.from([outcome.body]);
      Object.assign(message, { statusCode: outcome.statusCode, headers: { 'content-type': 'application/json' } });
      // System-boundary fixture: a readable with the IncomingMessage fields the registry client consumes.
      callback(message as unknown as IncomingMessage);
    });
    // System-boundary fixture: only the ClientRequest methods the registry client uses.
    return emitter as unknown as ClientRequest;
  };
  return { ...actual, request };
});

const profile = {
  profileId: 'registry_acme', displayName: 'Acme', origin: 'https://registry.acme.test', scopes: ['@acme'],
  useAsDefault: false, allowPrivateNetwork: true, credentialSecretRef: null, credentialRevision: 0,
  availability: 'unknown' as const, lastSuccessfulCheckAtMs: null, updatedAtMs: 1,
};

afterEach(() => {
  network.requests.splice(0);
  network.reply = null;
});

describe('npm registry profile probe', () => {
  it('checks the selected origin with ephemeral authorization and private-network policy', async () => {
    network.reply = () => ({ statusCode: 200, body: '{"ok":true}' });
    const probe = createNpmRegistryProfileProbe();
    await expect(probe({ profile, authorizationHeader: 'Bearer boundary-secret' })).resolves.toEqual({ status: 'available' });
    expect(network.requests).toEqual([expect.objectContaining({
      hostname: 'registry.acme.test',
      path: '/-/ping',
      headers: expect.objectContaining({ authorization: 'Bearer boundary-secret' }),
    })]);
  });

  it('classifies only typed authentication failures as authentication failures', async () => {
    const probe = createNpmRegistryProfileProbe();
    network.reply = () => ({ statusCode: 401, body: '' });
    await expect(probe({ profile })).resolves.toEqual({ status: 'authentication_failed' });

    network.reply = () => new Error('network down');
    await expect(probe({ profile })).resolves.toEqual({ status: 'offline' });
  });
});
