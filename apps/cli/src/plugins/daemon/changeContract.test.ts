import { describe, expect, it } from 'vitest';

import { PluginInstallationReviewRequestInterceptorSchema } from '@happier-dev/protocol/marketplace/internal';

import { projectPluginInstallationReviewRequestInterceptor } from './changeContract';

/**
 * Producer-side conformance for the CLI daemon emitter: the serialized review
 * schema and its owner-level admission tests live in
 * `@happier-dev/protocol/marketplace/internal`; this lane proves the values
 * the CLI daemon actually projects satisfy that cross-process contract.
 */
describe('CLI-emitted installation review conforms to the protocol review contract', () => {
  it('projects request-policy contributions into bounded, sorted review facts', () => {
    const fact = projectPluginInstallationReviewRequestInterceptor({
      id: 'rewrite-api',
      origins: ['https://b.example.test', 'https://a.example.test'],
      methods: ['POST', 'GET'],
      priority: 7,
    });

    expect(fact).toEqual({
      id: 'rewrite-api',
      origins: ['https://a.example.test', 'https://b.example.test'],
      methods: ['GET', 'POST'],
      priority: 7,
    });
    expect(PluginInstallationReviewRequestInterceptorSchema.safeParse(fact).success).toBe(true);
  });

  it('defaults an undeclared chain priority and omits an undeclared method scope', () => {
    const fact = projectPluginInstallationReviewRequestInterceptor({
      id: 'shape-api',
      origins: ['https://api.example.test'],
    });

    expect(fact).toEqual({
      id: 'shape-api',
      origins: ['https://api.example.test'],
      priority: 0,
    });
    expect(PluginInstallationReviewRequestInterceptorSchema.safeParse(fact).success).toBe(true);
  });
});
