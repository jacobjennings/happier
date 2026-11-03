import type { ActionInputFieldHint } from '../actionInputHintsRuntime.js';
import type { PluginSettingsAdministrationActionIdV1 } from '../../plugins/settingsAdministration.js';

const plugin = { path: 'pluginId', title: 'Plugin id', widget: 'text', required: true } as const;
const localId = { path: 'localId', title: 'Setting or secret id', widget: 'text', required: true } as const;
const scope = { path: 'scope', title: 'Settings scope', widget: 'json', required: true } as const;
const target = { path: 'target', title: 'Settings target', description: 'Use the exact Account or daemon target matching the selected scope.', widget: 'json', required: true } as const;
const revision = { path: 'expectedRevision', title: 'Expected revision', widget: 'text' } as const;
const binding = { path: 'bindingServerIdentityId', title: 'Home-specific binding', description: 'Account scope only. A Home identity string, or explicit null for the declared fallback.', widget: 'json' } as const;
const settings = [plugin, scope, target];
const field = [...settings, localId, binding];
const secret = [plugin, localId, { ...scope, required: false }, { ...target, required: false },
  { path: 'secretDaemonTarget', title: 'Secret daemon target', widget: 'json' },
  { path: 'canonicalOrigin', title: 'Credential origin', widget: 'url' },
] satisfies ActionInputFieldHint[];

export const PLUGIN_SETTINGS_INPUT_FIELDS = {
  'plugins.settings.list': settings,
  'plugins.settings.get': field,
  'plugins.settings.set': [...field, { path: 'value', title: 'New value', widget: 'json', required: true }, revision],
  'plugins.settings.reset': [...field, revision],
  'plugins.settings.secret.status': secret,
  'plugins.settings.secret.bind': [...secret, revision, { path: 'savedSecretId', title: 'Existing Saved Secret id', widget: 'text', required: true }],
  'plugins.settings.secret.unbind': [...secret, revision],
  'plugins.settings.secret.delete': [...secret, revision],
} satisfies Record<PluginSettingsAdministrationActionIdV1, ActionInputFieldHint[]>;
