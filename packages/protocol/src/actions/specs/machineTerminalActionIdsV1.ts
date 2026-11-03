
/** Action identity leaf: schema modules and the registry share these constants. */
export const MACHINE_TERMINAL_ACTION_IDS = [
  'machines.terminal.open', 'machines.terminal.list', 'machines.terminal.read',
  'machines.terminal.write', 'machines.terminal.close', 'machines.terminal.restart',
] as const;
