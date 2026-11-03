import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ingestPluginManifestV2 } from '@happier-dev/protocol';
import type { PluginApi } from '@happier-dev/plugin-sdk';
import { loadPluginModule } from '../runtime/loadPluginModule';
import { inspectPluginDevelopmentSource } from '../authoring/sourceObserver';

const fixtureRoot = fileURLToPath(new URL(
  '../testkit/fixtures/packed-external-voice-provider',
  import.meta.url,
));
const publicAuthoringRoot = fileURLToPath(new URL(
  '../../../../../packages/plugin-sdk/examples/public-authoring',
  import.meta.url,
));

type SourceDaemonModule = Readonly<Record<string, unknown>> & Readonly<{
  activate(api: Readonly<{
    agents: Pick<PluginApi['agents'], 'register'>;
    voiceProviders: Pick<PluginApi['voiceProviders'], 'register'>;
  }>): void;
}>;

describe('packed external Voice provider author contract', () => {
  it('classifies the fixture package root and loads its development daemon entry under committed authorization', async () => {
    await expect(inspectPluginDevelopmentSource({ projectRoot: fixtureRoot })).resolves.toMatchObject({
      ok: true,
      sourceKind: 'packageRoot',
      authoringKind: 'manifest',
      sourceRootPath: fixtureRoot,
      developmentEntryPath: join(fixtureRoot, 'src', 'voiceDaemon.ts'),
    });
    const daemonModule = await loadPluginModule<SourceDaemonModule>({
      source: {
        kind: 'file_backed',
        entryPath: join(fixtureRoot, 'dist', 'daemon.js'),
        devEntryPath: join(fixtureRoot, 'src', 'voiceDaemon.ts'),
        useDevelopmentEntry: true,
        trustPolicy: 'prompt',
        committedAuthorization: {
          pluginId: 'acme.packed-voice',
          immutableGenerationId: 'packed-external-voice-source-contract',
        },
      },
    });

    const daemonAgents = new Map<string, Parameters<PluginApi['agents']['register']>[1]>();
    const daemonRegistrations = new Map<string, unknown>();
    daemonModule.activate({
      agents: {
        register(localId, factory) {
          daemonAgents.set(localId, factory);
        },
      },
      voiceProviders: {
        register(localId, runtime) {
          daemonRegistrations.set(localId, runtime);
        },
      },
    });

    expect([...daemonAgents.keys()]).toEqual(['voice-agent']);
    expect([...daemonRegistrations.keys()]).toEqual(['speech-stt', 'speech-tts']);
  });

  it('admits the fixture manifest with exact raw SavedSecret and Connected Account grants and public authoring credential sources', async () => {
    const manifest = JSON.parse(await readFile(
      join(fixtureRoot, '.happier-plugin', 'plugin.json'),
      'utf8',
    )) as Readonly<{
      id: string;
      contributes: Readonly<{
        agents?: readonly Readonly<{
          id: string;
          primary?: string;
          runtime?: Readonly<{ kind: string }>;
        }>[];
        voiceProviders: readonly Readonly<{
          id: string;
          platforms: readonly string[];
          execution?: Readonly<{
            kind: string;
            agent: string | Readonly<{ pluginId: string; localId: string }>;
            supportedRuntimeVersions: readonly string[];
          }>;
          credentials?: Readonly<{ sources: readonly unknown[] }>;
          settings?: Readonly<{
            actions?: readonly Readonly<{ id: string }>[];
          }>;
          catalogs?: readonly Readonly<{ kind: string; settingFieldId: string }>[];
        }>[];
      }>;
    }>;
    const clientPlatforms = ['web', 'ios', 'android'] as const;
    const rawConversation = manifest.contributes.voiceProviders.find(
      ({ id }) => id === 'conversation-raw',
    );
    const agentRealtimeConversation = manifest.contributes.voiceProviders.find(
      ({ id }) => id === 'conversation-mediated',
    );

    expect(ingestPluginManifestV2(manifest)).toMatchObject({ ok: true });
    expect(manifest.contributes.agents).toEqual([
      expect.objectContaining({
        id: 'voice-agent',
        primary: 'sessions',
        runtime: { kind: 'custom' },
      }),
    ]);
    expect(agentRealtimeConversation?.execution).toEqual({
      kind: 'experimental_agent_session_realtime',
      agent: 'voice-agent',
      supportedRuntimeVersions: ['1.0.0'],
    });
    expect(manifest.contributes.voiceProviders.map(({ id }) => (
      `${manifest.id}/${id}`
    ))).toEqual([
      'acme.packed-voice/conversation-mediated',
      'acme.packed-voice/conversation-raw',
      'acme.packed-voice/speech-stt',
      'acme.packed-voice/speech-tts',
    ]);
    expect(manifest.contributes.voiceProviders.flatMap(({ id, settings }) => (
      (settings?.actions ?? []).map((action) => `${id}/${action.id}`)
    ))).toEqual(['conversation-mediated/provision-voice']);
    expect(manifest.contributes.voiceProviders.find(({ id }) => id === 'speech-stt')?.catalogs)
      .toEqual([{ kind: 'models', settingFieldId: 'model', allowCustom: true }]);
    expect(manifest.contributes.voiceProviders.find(({ id }) => id === 'speech-tts')?.catalogs)
      .toEqual([{ kind: 'voices', settingFieldId: 'voice', allowCustom: false }]);

    const rawConnectionGrants = clientPlatforms.map((realm) => ({
      realm,
      phase: 'connection',
      request: {
        kind: 'httpHeaders',
        origin: 'https://voice.example.test',
        headerNames: ['authorization'],
      },
    }));
    expect(rawConversation?.platforms).toEqual(clientPlatforms);
    expect(rawConversation?.credentials?.sources).toEqual([
      expect.objectContaining({
        kind: 'savedSecret',
        rawGrants: rawConnectionGrants,
      }),
      expect.objectContaining({
        kind: 'connectedAccount',
        service: { pluginId: 'acme.connected-accounts', localId: 'voice-oauth' },
        rawGrants: rawConnectionGrants,
      }),
    ]);

    const { publicAuthoringDefinition } = await import(pathToFileURL(
      join(publicAuthoringRoot, 'definition.ts'),
    ).href);
    const publicRawConversation = publicAuthoringDefinition.voiceProviders?.['raw-browser']?.declaration;
    expect(publicRawConversation?.credentials?.sources).toEqual([
      expect.objectContaining({ kind: 'savedSecret' }),
      expect.objectContaining({
        kind: 'connectedAccount',
        service: { pluginId: 'acme.connected-accounts', localId: 'voice-oauth' },
      }),
    ]);
  });
});
