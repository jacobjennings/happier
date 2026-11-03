import type { ActionInputFieldHint } from '../actionInputHintsRuntime.js';
import type { MACHINE_PROCESSES_ACTION_IDS } from './machineProcessesActionIdsV1.js';

type ActionId = typeof MACHINE_PROCESSES_ACTION_IDS[number];
const ref = { path: 'ref', title: 'Process reference', description: 'Use the opaque reference from machines.processes.list or get.', widget: 'text', required: true } as const;
const refs = { path: 'refs', title: 'Process references', description: 'Use distinct references from the current Machine process inventory.', widget: 'json', required: true } as const;
const targets = { path: 'targets', title: 'Reviewed processes', description: 'The complete selected set of {ref, expect} values from the current process checks.', widget: 'json', required: true } as const;

export const MACHINE_PROCESS_INPUT_FIELDS = {
  'machines.processes.list': [
    { path: 'scope', title: 'Process scope', widget: 'select', options: [{ value: 'happier', label: 'Happier processes' }, { value: 'all', label: 'All processes' }] },
    { path: 'view', title: 'Group by', widget: 'select', options: [{ value: 'tree', label: 'Process tree' }, { value: 'owners', label: 'Work owner' }] },
    { path: 'sessionId', title: 'Session id', widget: 'text' },
    { path: 'query', title: 'Search', widget: 'text' },
  ],
  'machines.processes.get': [ref],
  'machines.processes.check': [refs],
  'machines.processes.stop': [targets],
  'machines.processes.kill': [targets, { path: 'tree', title: 'Include child processes', widget: 'boolean', required: true }],
  'machines.processes.startAgain': [ref],
  'machines.processes.leftBehind.cleanUp': [refs],
} satisfies Record<ActionId, ActionInputFieldHint[]>;
