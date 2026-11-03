
/** Action identity leaf: schema modules and the registry share these constants. */
export const MACHINE_PROCESSES_ACTION_IDS = [
  'machines.processes.list', 'machines.processes.get', 'machines.processes.check', 'machines.processes.stop',
  'machines.processes.startAgain', 'machines.processes.kill', 'machines.processes.leftBehind.cleanUp',
] as const;
