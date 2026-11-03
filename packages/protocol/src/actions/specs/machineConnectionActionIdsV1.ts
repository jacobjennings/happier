
/** Action identity leaf: schema modules and the registry share these constants. */
export const MACHINE_PAGE_ACTION_IDS = ['machines.metadata.update', 'machines.daemon.stop', 'machines.remove', 'machines.capabilities.install', 'machines.replacement.set', 'machines.replacement.clear'] as const;
export const MACHINE_MANAGED_INSTALLATION_ACTION_IDS = ['machines.managed.bootstrap.respond'] as const;
export const MACHINE_ADD_SSH_ACTION_IDS = ['machines.add.ssh.start', 'machines.add.ssh.status', 'machines.add.ssh.respond', 'machines.add.ssh.cancel'] as const;
