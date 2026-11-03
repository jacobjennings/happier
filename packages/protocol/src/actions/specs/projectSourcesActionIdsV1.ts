
/** Action identity leaf: schema modules and the registry share these constants. */
export const PROJECT_SOURCE_ACTION_IDS_V1 = [
  'projects.sources.list', 'projects.sources.read', 'projects.sources.create',
  'projects.sources.update', 'projects.sources.delete', 'projects.sources.moveToTeam',
  'projects.deploymentDefaults.set',
] as const;
