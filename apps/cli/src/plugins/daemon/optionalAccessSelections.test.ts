import { describe, expect, it } from 'vitest';

import { readCanonicalPluginManifest } from '@/plugins/manifest/normalize';
import { createDefaultPluginAccessScopeRegistry } from '@/plugins/store/install/accessScopeRegistry';
import { createPluginManifestV2Fixture } from '@/plugins/testkit/manifestV2Fixture';

import { updateSelectedPluginOptionalAccess } from './optionalAccessSelections';

const pluginId = 'acme.optional-delta';

function manifest() {
  const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
    id: pluginId,
    hostAccess: {
      required: [],
      optional: [{
        id: 'sessions',
        capability: 'sessions',
        reason: 'Read selected sessions',
        scope: { access: ['read'] },
      }, {
        id: 'session-history',
        capability: 'sessions',
        reason: 'Read selected session history',
        scope: { access: ['read'] },
      }],
    },
  }));
  if (!parsed) throw new Error('Expected canonical manifest fixture');
  return parsed;
}

describe('updateSelectedPluginOptionalAccess', () => {
  it('preserves a valid incumbent grant when a delta-only decision does not mention it', () => {
    const existing = createDefaultPluginAccessScopeRegistry().createSelection({
      pluginId,
      accessId: 'sessions',
      capability: 'sessions',
      scope: { access: ['read'] },
      selectedAtMs: 7,
    });

    expect(updateSelectedPluginOptionalAccess({
      pluginId,
      manifest: manifest(),
      existing: [existing],
      decisions: [],
      selectedAtMs: 11,
    })).toEqual([existing]);
  });

  it('applies an explicit deselection without disturbing unrelated authority state', () => {
    const registry = createDefaultPluginAccessScopeRegistry();
    const existing = registry.createSelection({
      pluginId,
      accessId: 'sessions',
      capability: 'sessions',
      scope: { access: ['read'] },
      selectedAtMs: 7,
    });
    const unrelated = registry.createSelection({
      pluginId,
      accessId: 'session-history',
      capability: 'sessions',
      scope: { access: ['read'] },
      selectedAtMs: 5,
    });

    expect(updateSelectedPluginOptionalAccess({
      pluginId,
      manifest: manifest(),
      existing: [existing, unrelated],
      decisions: [{ accessId: 'sessions', selected: false }],
      selectedAtMs: 11,
    })).toEqual([unrelated]);
  });
});
