
/** Action identity leaf: schema modules and the registry share these constants. */
export const MACHINE_WORK_SUMMARY_ACTION_IDS = ['machines.work.summary.get'] as const;
export const MACHINE_ACCESS_ACTION_IDS = [
  'machines.access.grants.list', 'machines.access.grant.set', 'machines.access.grant.remove',
  'machines.access.leave', 'machines.access.prepareKeys',
] as const;
