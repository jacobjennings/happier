import { describe, expect, it } from 'vitest';
import type { PluginUpdatePolicyV1 } from '@happier-dev/protocol';

import type { PluginStateRecord } from '@/plugins/store/state';

import { resolveInstalledPluginUpdate } from './resolveInstalledUpdate';

function npmRecord(
  updatePolicy: PluginUpdatePolicyV1 | undefined,
  manifestVersion = '1.0.0',
): PluginStateRecord {
  const record: PluginStateRecord = {
    source: {
      kind: 'package',
      locator: '@acme/example',
      trustPolicy: 'prompt',
      installPolicy: 'managed_install',
      resolvedPath: '/tmp/installed',
      manifestPath: '/tmp/installed/.happier-plugin/plugin.json',
    },
    compatibility: { status: 'compatible', diagnostics: [] },
    install: {
      mode: 'managed_install',
      manifestVersion,
      ...(updatePolicy ? { updatePolicy } : {}),
      trust: {
        pluginId: 'acme.example',
        state: 'trusted',
        approvedAtMs: 1,
        distribution: {
          kind: 'npm',
          packageName: '@acme/example',
          registryOrigin: 'https://registry.example.test',
          registryProfileId: 'registry_private',
        },
      },
    },
    state: { enabled: true },
  };
  return record;
}

describe('resolveInstalledPluginUpdate', () => {
  it('preserves the daemon-owned npm channel and policy while leaving version resolution open', () => {
    expect(resolveInstalledPluginUpdate('acme.example', npmRecord('allowed'))).toEqual({
      kind: 'npm',
      request: {
        kind: 'installNpm',
        packageName: '@acme/example',
        selector: '>=1.0.0',
        registryOrigin: 'https://registry.example.test',
        registryProfileId: 'registry_private',
      },
      updatePolicy: 'allowed',
    });
  });

  it('defaults an unpublished record without an explicit policy to allowed', () => {
    expect(resolveInstalledPluginUpdate('acme.example', npmRecord(undefined)))
      .toMatchObject({ kind: 'npm', updatePolicy: 'allowed' });
  });

  it('keeps preview updates on the same prerelease line and above the installed version', () => {
    expect(resolveInstalledPluginUpdate(
      'acme.example',
      npmRecord('allowed', '2.0.0-beta.1'),
    )).toMatchObject({
      kind: 'npm',
      request: {
        selector: '>=2.0.0-beta.1 <2.0.0',
      },
    });
  });

  it('rejects pinned channels instead of reinstalling or advancing them', () => {
    expect(() => resolveInstalledPluginUpdate('acme.example', npmRecord('pinned')))
      .toThrowError(expect.objectContaining({ code: 'plugin_update_pinned' }));
  });

  function localPathRecord(devWatch: boolean): PluginStateRecord {
    return {
      ...npmRecord('allowed'),
      source: {
        kind: 'path',
        locator: '/stale/consumer/path',
        trustPolicy: 'prompt',
        installPolicy: 'link',
        resolvedPath: '/tmp/source',
        manifestPath: '/tmp/source/.happier-plugin/plugin.json',
        ...(devWatch ? { devWatch: true } : {}),
      },
      install: {
        mode: 'link',
        manifestVersion: '1.0.0',
        updatePolicy: 'allowed',
        trust: {
          pluginId: 'acme.example',
          state: 'trusted',
          approvedAtMs: 1,
          distribution: {
            kind: 'localPath',
            canonicalPath: '/canonical/source',
          },
        },
      },
    };
  }

  it('updates a linked path install from the trusted canonical path, not the stale source locator', () => {
    expect(resolveInstalledPluginUpdate('acme.example', localPathRecord(false))).toEqual({
      kind: 'path',
      request: { kind: 'installPath', locator: '/canonical/source' },
    });
  });

  it('refuses development updates so they advance only through the registered source observer', () => {
    expect(() => resolveInstalledPluginUpdate('acme.example', localPathRecord(true)))
      .toThrowError(expect.objectContaining({ code: 'plugin_development_update_requires_reload' }));
  });
});
