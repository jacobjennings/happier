import * as React from 'react';
import type { ManagedControllerV1 } from '@happier-dev/protocol/machines/managed/managedMachineV1';
import { isMachineReplaced } from '@happier-dev/protocol/machines/identity/canonicalMachineId';
import { supportsMachineOperationProtocolCapabilityV1 } from '@happier-dev/protocol/machines/operationProtocolCapabilitiesV1';

import { MachineAdministrationTargetSelector } from '@/components/settings/machines/MachineAdministrationTargetSelector';
import { useThisComputerMachineId } from '@/components/machines/add/useMachineAddPaths';
import { isMachineAdministrationCandidateExplicitlySelectable, isMachineAdministrationCandidateSelectable, resolveMachineAdministrationTargetState } from '@/sync/domains/machines/administration/targetSelection';
import {
  useMachineAdministrationTargetPickerRows,
  resolveFreshMachineAdministrationExecutionTarget,
  doesMachineAdministrationTargetMatchActiveAccount,
  type MachineAdministrationTargetSelectionV1,
  type MachineAdministrationExecutionTargetOptions,
} from '@/sync/domains/machines/administration/useTargetSelection';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { useMachineListForServer, useActiveServerAccountScope, useSetting } from '@/sync/domains/state/storage';
import { useIsMachineListSettled, useMachineListStatusForServer } from '@/sync/store/hooks';
import { useServerCredentialAccountScopeBinding } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { t } from '@/text';
import { storage } from '@/sync/domains/state/storageStore';
import { useAccountSettingsScope } from '@/sync/store/settingsWriters';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { areAccountSettingsScopesEqual } from '@/sync/domains/settings/scope/accountSettingsScope';
import { MACHINE_ADMINISTRATION_SELECTION_KEYS_V1, setMachineAdministrationTargetPreference } from '@/sync/domains/machines/administration/selectionPreferences';
import { readMachineRequestReachabilityObservation } from '@/sync/domains/machines/reachability/machineReachability';
import { readPluginAccountAvailability } from '@/sync/domains/plugins/availability/projection';
import { useAdmittedManagedMachineAbsentEnrolledIds } from './useManagedMachineInventory';

export type ManagedControllerScope = Readonly<{
  /** The machine whose installation runs provider calls: the person's choice, else the preselected default. */
  controller: ManagedControllerV1 | undefined;
  /** The chosen machine's record, for its name and presence. */
  machine: Machine | undefined;
  /** Whether this Home has installed controller identities to show, including unavailable choices. */
  hasCandidates: boolean;
  /**
   * Whether this Home's machine list has been read: an empty `hasCandidates` before that is not
   * "no machine can manage", and `unavailable` is a list that could not be read (retry re-reads it).
   */
  machineList: 'settled' | 'loading' | 'unavailable';
  /** The canonical machine-scope chip, for the page header (or the section that owns the scope). */
  chip: React.ReactElement | null;
  /** The same chosen controller, revalidated by the Administration execution owner. */
  selection?: MachineAdministrationTargetSelectionV1;
}>;

/**
 * "Managed from": which of this Home's machines with an installation runs a provisioner's calls
 * (lab `m-add` / `m-config`). It is shown through the canonical header chip
 * (`MachineAdministrationTargetSelector presentation="chip"`), offering only machines that can manage,
 * and starts on an online controller admitted by the Action protocol, preferring held installed
 * provisioners and the person's last choice. The choice is page-local, as the
 * draft it scopes is.
 */
/** Installed controllers, including asleep ones, but never retired identities. */
export function isManagedControllerCandidate(machine: Machine): boolean {
  return !!machine.installationId && !machine.revokedAt && !isMachineReplaced(machine);
}

/** Provisioner calls use the same operation protocol required by external Action admission. */
function supportsManagedControllerActions(machine: Machine): boolean {
  return typeof machine.operationProtocolCapabilitiesRevision === 'number' && machine.operationProtocolCapabilitiesRevision >= 1
    && supportsMachineOperationProtocolCapabilityV1(machine.operationProtocolCapabilities, 'externalActionExecutionAuthorization');
}

export function useManagedControllerScope(
  input: Readonly<{
    serverId: string;
    /** A machine the page already names (a preset's controller, the picker's handoff), used until the person picks. */
    preferred?: ManagedControllerV1;
    disabled?: boolean;
    onSelect?: (controller: ManagedControllerV1) => void;
    testIDPrefix: string;
  }>,
): ManagedControllerScope {
  const machines = useMachineListForServer(input.serverId);
  const listSettled = useIsMachineListSettled(input.serverId);
  const listStatus = useMachineListStatusForServer(input.serverId);
  const activeAccountScope = useActiveServerAccountScope();
  const { binding } = useServerCredentialAccountScopeBinding(input.serverId);
  const rows = useMachineAdministrationTargetPickerRows();
  const thisMachineId = useThisComputerMachineId();
  // The person's last explicit pick on this device, so re-entering Add starts where they left off.
  const rememberedTarget = useSetting('machineAdministrationTargetsLocalV1')[MACHINE_ADMINISTRATION_SELECTION_KEYS_V1.managedMachines];
  const settingsScope = useAccountSettingsScope();
  const [chosen, setChosen] = React.useState<Readonly<{
    serverId: string; accountId: string | undefined; controller: ManagedControllerV1; explicit: boolean;
  }>>();
  const accountId = binding?.isCurrent() ? binding.scope.accountId : undefined;
  const scopedChoice = chosen && chosen.accountId === accountId && areServerProfileIdentifiersEquivalent(chosen.serverId, input.serverId)
    ? chosen : undefined;
  const preferredMachineId = input.preferred?.machineId;
  const preferredInstallationId = input.preferred?.installationId;
  const namedRetained = scopedChoice?.explicit ? scopedChoice.controller
    : preferredMachineId && preferredInstallationId ? input.preferred : undefined;
  const { onSelect } = input;

  // The open shared chooser already demands this Home's managed inventory. Observe its
  // admitted absence facts without opening or retaining a second list read.
  const absentMachineIds = useAdmittedManagedMachineAbsentEnrolledIds(input.serverId, binding);
  const controllerMachines = React.useMemo(() => (machines ?? []).filter(isManagedControllerCandidate), [machines]);
  const controllerIds = React.useMemo(() => new Set(controllerMachines.map(machine => machine.id)), [controllerMachines]);
  const eligible = React.useMemo(
    () =>
      controllerMachines.filter(machine => !absentMachineIds.has(machine.id)),
    [absentMachineIds, controllerMachines],
  );
  const eligibleById = React.useMemo(() => new Map(eligible.map(machine => [machine.id, machine])), [eligible]);
  const availabilityReader = React.useMemo(() => binding?.isCurrent() ? readPluginAccountAvailability(binding.scope) : null, [binding]);
  const subscribeCapabilities = React.useCallback((notify: () => void) => availabilityReader?.subscribe(notify) ?? (() => {}), [availabilityReader]);
  const readCapabilities = React.useCallback(() => {
    const installed = binding?.isCurrent() ? availabilityReader?.readInstalledPlugins() : undefined;
    if (installed?.kind !== 'available') return eligible.map(() => 'unknown').join('|');
    const declarations = new Map<string, 'supported' | 'unknown'>();
    for (const plugin of installed.plugins) for (const installation of plugin.installations) {
      const materialization = installation.materialization;
      if (!materialization.enabled || materialization.trustState !== 'trusted'
        || !areServerProfileIdentifiersEquivalent(materialization.serverIdentityId, input.serverId)
        || !eligibleById.has(materialization.machineId) || declarations.get(materialization.machineId) === 'supported') continue;
      const provisioners = installation.declaration?.contributes.machineProvisioners ?? [];
      const platform = eligibleById.get(materialization.machineId)?.metadata?.platform;
      if (platform && provisioners.some(provisioner => provisioner.platforms.some(supported => supported === platform))) {
        declarations.set(materialization.machineId, 'supported');
      } else if (installation.declarationState === 'preparing' || !platform && provisioners.length > 0) {
        declarations.set(materialization.machineId, 'unknown');
      }
    }
    // A missing/preparing declaration is unknown. Only a complete admitted census can
    // establish no installed provisioner; the primitive projection ignores cursor/heartbeat churn.
    return eligible.map(machine => declarations.get(machine.id) === 'supported' ? 'supported'
      : installed.completeness === 'complete' && declarations.get(machine.id) !== 'unknown' ? 'unsupported' : 'unknown').join('|');
  }, [availabilityReader, binding, eligible, eligibleById, input.serverId]);
  const capabilities = React.useSyncExternalStore(subscribeCapabilities, readCapabilities, readCapabilities);
  const capabilityStates = React.useMemo(() => capabilities.split('|'), [capabilities]);
  const installedProvisionerMachines = React.useMemo(() => new Set(eligible.filter((_machine, index) => capabilityStates[index] === 'supported').map(machine => machine.id)), [capabilityStates, eligible]);
  const unsupportedProvisionerMachines = React.useMemo(() => new Set(eligible.filter((_machine, index) => capabilityStates[index] === 'unsupported').map(machine => machine.id)), [capabilityStates, eligible]);
  const scopedRows = React.useMemo(() => {
      const scoped = rows.filter(
        (row) =>
          areServerProfileIdentifiersEquivalent(row.serverId, input.serverId) &&
          (row.candidate.target.machineId === namedRetained?.machineId || controllerIds.has(row.candidate.target.machineId)),
      );
      // Absence withdraws admission, not the row's stable position or chooser lifetime.
      return scoped.map(row => absentMachineIds.has(row.candidate.target.machineId)
        ? { ...row, candidate: { ...row.candidate, availability: 'missing' as const } } : row);
    }, [absentMachineIds, controllerIds, input.serverId, namedRetained?.machineId, rows],
  );
  const automaticCandidates = React.useMemo(() => {
    const onlineIds = new Set(scopedRows.filter(row => isMachineAdministrationCandidateSelectable(row.candidate)).map(row => row.candidate.target.machineId));
    const readScope = binding?.isCurrent() ? binding.scope : null;
    const online = eligible.filter(machine => onlineIds.has(machine.id) && supportsManagedControllerActions(machine)
      && !unsupportedProvisionerMachines.has(machine.id)
      && readMachineRequestReachabilityObservation(readScope, machine.id)?.outcome !== 'failed');
    const knownCapable = online.filter(machine => installedProvisionerMachines.has(machine.id));
    return (knownCapable.length > 0 ? knownCapable : online).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  }, [binding, eligible, installedProvisionerMachines, scopedRows, unsupportedProvisionerMachines]);
  const automaticRetainedRow = !namedRetained && scopedChoice && !scopedChoice.explicit
    ? scopedRows.find((row) => row.candidate.target.machineId === scopedChoice.controller.machineId)
    : undefined;
  // An automatic pick is kept across presence churn only while its machine is still selectable; one that went
  // offline (a first frame from warm cache, a stale beat) yields to the next online controller.
  const automaticRetained = automaticRetainedRow && scopedChoice
    && automaticCandidates.some(machine => machine.id === scopedChoice.controller.machineId
      && machine.installationId === scopedChoice.controller.installationId)
    ? scopedChoice.controller
    : undefined;
  const retained = namedRetained ?? automaticRetained;
  // Kept identity-stable by its ids: presence updates must not restart the reads it scopes.
  const preferred = React.useMemo(() => {
    // A draft keeps its exact installation even when asleep, missing or replaced; fresh execution
    // admission decides whether it can run. Inventory churn must never silently redirect it.
    if (retained) return retained;
    const remembered = rememberedTarget ? automaticCandidates.find((candidate) => candidate.id === rememberedTarget.machineId
      && scopedRows.some((row) => row.candidate.target.machineId === candidate.id
        && row.candidate.target.serverIdentityId === rememberedTarget.serverIdentityId)) : undefined;
    const machine = remembered ?? automaticCandidates.find((candidate) => candidate.id === thisMachineId) ?? automaticCandidates[0];
    return machine?.installationId
      ? { machineId: machine.id, installationId: machine.installationId }
      : undefined;
  }, [retained?.machineId, retained?.installationId, automaticCandidates, scopedRows, thisMachineId, rememberedTarget?.machineId, rememberedTarget?.serverIdentityId]);
  const controllerMachineId = preferred?.machineId;
  const controllerInstallationId = preferred?.installationId;
  const controller = React.useMemo(
    (): ManagedControllerV1 | undefined =>
      controllerMachineId && controllerInstallationId
        ? { machineId: controllerMachineId, installationId: controllerInstallationId }
        : undefined,
    [controllerMachineId, controllerInstallationId],
  );
  React.useEffect(() => {
    if (!retained && controller) setChosen({ serverId: input.serverId, accountId, controller, explicit: false });
  }, [retained?.machineId, retained?.installationId, controller, input.serverId, accountId]);

  const selection =
    React.useMemo((): MachineAdministrationTargetSelectionV1 => {
      const candidates = scopedRows.map(row => row.candidate);
      const selectedTarget =
        scopedRows.find(
          (row) => row.candidate.target.machineId === controller?.machineId,
        )?.candidate.target ?? null;
      const matchesAccount = doesMachineAdministrationTargetMatchActiveAccount({ target: selectedTarget, activeAccountServerId: activeAccountScope?.serverId });
      const resolveExecutionTarget = (options?: MachineAdministrationExecutionTargetOptions) => {
        if (!matchesAccount || !selectedTarget || !controller || !binding?.isCurrent()) return null;
        if (absentMachineIds.has(controller.machineId)) return null;
        const current = resolveFreshMachineAdministrationExecutionTarget(selectedTarget, { ...options, accountScope: binding.scope });
        return current?.machine.installationId === controller.installationId && supportsManagedControllerActions(current.machine) ? current : null;
      };
      return {
        candidates,
        pickerRows: scopedRows,
        state: resolveMachineAdministrationTargetState({
          storedTarget: selectedTarget,
          candidates,
          allowSoleCandidate: false,
        }),
        selectedTarget,
        selectedTargetServerMatchesActiveAccount: matchesAccount,
        canExecute: resolveExecutionTarget() !== null,
        changeIntent: onSelect ? 'draft' : 'scope',
        selectTarget: (target) => {
          if (!scopedRows.some(row => row.candidate.target.machineId === target.machineId
            && row.candidate.target.serverIdentityId === target.serverIdentityId
            && isMachineAdministrationCandidateExplicitlySelectable(row.candidate, 'lastKnown'))) return;
          const machine = eligible.find(
            (candidate) => candidate.id === target.machineId,
          );
          if (!machine?.installationId) return;
          const next = {
            machineId: machine.id,
            installationId: machine.installationId,
          };
          setChosen({ serverId: input.serverId, accountId, controller: next, explicit: true });
          const current = storage.getState();
          if (settingsScope && areAccountSettingsScopesEqual(settingsScope, current.settingsScope)) {
            getSyncSingleton().applySettings({ machineAdministrationTargetsLocalV1: setMachineAdministrationTargetPreference(
              current.settings.machineAdministrationTargetsLocalV1, MACHINE_ADMINISTRATION_SELECTION_KEYS_V1.managedMachines, target) },
              { expectedSettingsScope: settingsScope, source: 'ui' });
          }
          onSelect?.(next);
        },
        clearTarget: () => {},
        resolveExecutionTarget,
      };
    }, [absentMachineIds, binding, controller?.machineId, controller?.installationId, eligible, onSelect, scopedRows, activeAccountScope?.serverId, input.serverId, accountId, settingsScope]);

  const chip =
    scopedRows.length > 0 ? (
      <MachineAdministrationTargetSelector
        presentation="chip"
        selection={selection}
        groupTitle={t('managedMachines.config.managedFrom')}
        selectionPolicy="lastKnown"
        disabled={input.disabled}
        testIDPrefix={input.testIDPrefix}
      />
    ) : null;
  return {
    controller,
    machine: machines?.find((machine) => machine.id === controller?.machineId),
    hasCandidates: controllerMachines.length > 0,
    machineList: listSettled ? 'settled' : listStatus === 'error' || listStatus === 'signedOut' ? 'unavailable' : 'loading',
    chip,
    selection,
  };
}
