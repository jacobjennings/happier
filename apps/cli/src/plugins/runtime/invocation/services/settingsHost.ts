import type { PluginSettingsContributionV2 } from '@happier-dev/protocol';

import type { PluginStorePaths } from '@/plugins/store/paths';
import { createAccountPluginSettingsRecordStorage } from '../../context/accountPluginSettingsRecordStorage';
import { createPluginStorageOwner } from '../../context/storage';
import type { StablePluginEventsBroker } from './events';
import {
    createAccountSettingsBackedSettingsRecordStore,
    createPluginStorageBackedSettingsRecordStore,
    createRoutedPluginSettingsRecordStore,
    createStablePluginSettingsHost,
    type PluginAccountSettingsRecordAdapter,
} from './settings';

/** One Settings composition for ordinary and operation-specific declarations. */
export function createProductionPluginSettingsHostFactory(params: Readonly<{
    accountScoped: boolean;
    accountSettingsRecordAdapter?: PluginAccountSettingsRecordAdapter;
    storagePaths?: PluginStorePaths;
    broker: StablePluginEventsBroker;
    onPluginSettingsUnavailable?(input: Readonly<{ pluginId: string; error: unknown }>): void;
}>) {
    // A scoped invocation may use only its captured producer. Ordinary daemon
    // invocations retain the active-Account persistence owner.
    const accountSettingsRecordAdapter = params.accountSettingsRecordAdapter
        ?? (params.accountScoped ? null : createAccountPluginSettingsRecordStorage());
    const { storagePaths } = params;
    return (declarations: readonly Readonly<{
        pluginId: string;
        contribution: PluginSettingsContributionV2;
    }>[]) => createStablePluginSettingsHost({
        declarations: declarations.filter(entry => accountSettingsRecordAdapter !== null || entry.contribution.scope !== 'account'),
        ...(params.onPluginSettingsUnavailable ? { onPluginSettingsUnavailable: params.onPluginSettingsUnavailable } : {}),
        recordStore: createRoutedPluginSettingsRecordStore([
            ...(storagePaths ? [createPluginStorageBackedSettingsRecordStore({
                storageForPlugin(pluginId) {
                    return createPluginStorageOwner({ pluginId, paths: storagePaths }).daemon;
                },
            })] : []),
            ...(accountSettingsRecordAdapter ? [createAccountSettingsBackedSettingsRecordStore(accountSettingsRecordAdapter)] : []),
        ]),
        broker: params.broker,
    });
}
