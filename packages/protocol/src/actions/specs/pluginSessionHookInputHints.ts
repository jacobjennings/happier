import type { ActionInputFieldHint } from '../actionInputHintsRuntime.js';

const agent = { path: 'agent', title: 'Agent contribution', description: 'The exact {pluginId, localId} Agent from the hook inventory.', widget: 'json', required: true } as const;
const installation = { path: 'installationId', title: 'Hook installation id', widget: 'text', required: true } as const;

export const PLUGIN_SESSION_HOOK_STATUS_INPUT_FIELDS = [
  { path: 'intent', title: 'Status request', widget: 'select', required: true, options: [
    { value: 'passive_inventory', label: 'Installed hooks' },
    { value: 'install_preview', label: 'Preview installation' },
    { value: 'installation_recheck', label: 'Check an installation' },
  ] },
  { ...agent, required: false, requiredWhen: { op: 'or', any: [
    { op: 'eq', path: 'intent', value: 'install_preview' },
    { op: 'eq', path: 'intent', value: 'installation_recheck' },
  ] } },
  { path: 'cursor', title: 'Next page', widget: 'text', visibleWhen: { op: 'eq', path: 'intent', value: 'passive_inventory' } },
  { path: 'limit', title: 'Maximum results', widget: 'integer', visibleWhen: { op: 'eq', path: 'intent', value: 'passive_inventory' } },
  { ...installation, visibleWhen: { op: 'eq', path: 'intent', value: 'installation_recheck' } },
] satisfies ActionInputFieldHint[];
export const PLUGIN_SESSION_HOOK_INSTALL_INPUT_FIELDS = [agent,
  { path: 'expectedPreviewId', title: 'Reviewed installation preview', widget: 'text', required: true },
] satisfies ActionInputFieldHint[];
export const PLUGIN_SESSION_HOOK_MUTATION_INPUT_FIELDS = [agent, installation] satisfies ActionInputFieldHint[];
