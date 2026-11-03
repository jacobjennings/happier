/** Action identity leaf: schema modules and the registry share these constants. */
export const PROJECT_SERVICE_PLACEMENT_ACTION_IDS_V1 = [
  'projects.service.placement.get', 'projects.service.placement.set',
] as const;

export const PROJECT_WORKER_ACTION_IDS_V1 = [
  'projects.worker.preferences.get', 'projects.worker.preferences.set', 'projects.worker.preferences.reset',
  'machines.worker.policy.get', 'machines.worker.policy.set',
  'projects.worker.status', 'projects.worker.copy.inspect', 'projects.worker.copy.retire',
  ...PROJECT_SERVICE_PLACEMENT_ACTION_IDS_V1,
] as const;
