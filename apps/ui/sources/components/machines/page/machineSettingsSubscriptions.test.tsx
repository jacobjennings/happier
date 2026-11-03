import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { createMachineFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { createProviderSettingsAccountHarness } from '@/dev/testkit/harness/providerSettingsHarness';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';
import { installSettingsViewCommonModuleMocks } from '@/components/settings/settingsViewTestHelpers';

installSettingsViewCommonModuleMocks({ storage: 'real' });
const account = createProviderSettingsAccountHarness();
await loadSyncSingletonForTests();
const { storage } = await import('@/sync/domains/state/storage');
const { MachineThisMachineSection } = await import('./MachineThisMachineSection');
const { MachineWindowsLaunchSection } = await import('../windows/MachineWindowsLaunchSection');
const { Item } = await import('@/components/ui/lists/Item');

afterEach(async () => { standardCleanup(); await account.reset(); });

describe('Machine settings subscriptions', () => {
    it.each(['summary', 'windows'] as const)('%s ignores unrelated preferences and commits once for a consumed key', async kind => {
        const machine = createMachineFixture({ metadata: { ...createMachineFixture().metadata!, platform: 'win32' } });
        await account.restore({ waivedActions: ['settings.set'], machines: [machine], settings: {
            sessionTerminalHost: 'none', sessionUseTmux: false, sessionWindowsRemoteSessionLaunchMode: 'hidden',
        } });
        let commits = 0;
        const screen = await renderScreen(<React.Profiler id={kind} onRender={() => { commits++; }}>
            {kind === 'summary'
                ? <MachineThisMachineSection serverId={account.serverId} machine={machine} />
                : <MachineWindowsLaunchSection serverId={account.serverId} machine={machine} windowsTerminalAvailable />}
        </React.Profiler>);
        commits = 0;
        await act(async () => { storage.setState({ settings: { ...storage.getState().settings, analyticsOptOut: !storage.getState().settings.analyticsOptOut } }); });
        expect(commits).toBe(0);
        await act(async () => { storage.setState({ settings: { ...storage.getState().settings,
            ...(kind === 'summary' ? { sessionTerminalHost: 'tmux' as const } : { sessionWindowsRemoteSessionLaunchMode: 'console' as const }),
        } }); });
        expect(commits).toBe(1);
        if (kind === 'summary') expect(screen.findAllByType(Item).find(node => node.props.testID === 'machine-page-row-terminal')?.props.subtitle).toBe('tmux');
    });
});
