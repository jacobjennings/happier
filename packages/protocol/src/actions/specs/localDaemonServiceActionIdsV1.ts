
/** Action identity leaf: schema modules and the registry share these constants. */
export const LOCAL_DAEMON_SERVICE_ACTION_IDS = [
  'machines.local.service.status', 'machines.local.service.start', 'machines.local.service.stop',
  'machines.local.service.restart', 'machines.local.service.autostart.set',
  'machines.local.service.update', 'machines.local.service.disconnect',
] as const;
