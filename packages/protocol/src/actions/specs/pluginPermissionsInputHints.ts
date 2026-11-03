import type { ActionInputFieldHint } from '../actionInputHintsRuntime.js';
import type { PluginPermissionGrantActionIdV1 } from '../../plugins/permissions/actions.js';

export const PLUGIN_PERMISSION_INPUT_FIELDS: Partial<Record<PluginPermissionGrantActionIdV1, ActionInputFieldHint[]>> = {
  'plugins.permissions.grants.list': [
    { path: 'pluginId', title: 'Plugin id', widget: 'text' },
    { path: 'grantId', title: 'Grant id', widget: 'text' },
    { path: 'capability', title: 'Permission capability', widget: 'text' },
    { path: 'targetScope', title: 'Permission target', widget: 'json' },
    { path: 'subject', title: 'Permission subject', widget: 'json' },
    { path: 'includeRevoked', title: 'Include revoked grants', widget: 'boolean' },
    { path: 'includeResolvedRequests', title: 'Include resolved requests', widget: 'boolean' },
    { path: 'limit', title: 'Maximum results', widget: 'integer' },
  ],
  'plugins.permissions.grants.revoke': [
    { path: 'grantId', title: 'Grant id', widget: 'text', required: true },
    { path: 'reason', title: 'Reason', widget: 'text' },
  ],
} satisfies Partial<Record<PluginPermissionGrantActionIdV1, ActionInputFieldHint[]>>;
