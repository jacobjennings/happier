import { beforeEach, vi } from 'vitest';

type MachineDetailsModuleFactory = () => unknown | Promise<unknown>;

type InstallMachineDetailsCommonModuleMocksOptions = Readonly<{
    reactNative?: MachineDetailsModuleFactory;
    router?: MachineDetailsModuleFactory;
    unistyles?: MachineDetailsModuleFactory;
    text?: MachineDetailsModuleFactory;
    modal?: MachineDetailsModuleFactory;
}>;

const machineDetailsModuleState = vi.hoisted(() => ({
    options: {} as InstallMachineDetailsCommonModuleMocksOptions,
}));

export function installMachineDetailsCommonModuleMocks(
    options: InstallMachineDetailsCommonModuleMocksOptions = {},
) {
    machineDetailsModuleState.options = options;

    beforeEach(async () => {
        const { clearDaemonMergedProjectionCacheForTests } = await import('@/agents/backendCatalog/loadDaemonMergedProjectionInputs');
        clearDaemonMergedProjectionCacheForTests();
    });


    vi.mock('react-native', async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            TurboModuleRegistry: { getEnforcing: () => ({}) },
            View: 'View',
            Text: 'Text',
            ScrollView: 'ScrollView',
            ActivityIndicator: 'ActivityIndicator',
            RefreshControl: 'RefreshControl',
            Pressable: 'Pressable',
            TextInput: 'TextInput',
        });
    });

    vi.mock('@expo/vector-icons', () => ({
        Ionicons: 'Ionicons',
        Octicons: 'Octicons',
    }));

    vi.mock('expo-router', async () => {
        const activeOptions = machineDetailsModuleState.options;
        if (activeOptions.router) {
            return await activeOptions.router();
        }
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                back: vi.fn(),
                push: vi.fn(),
                replace: vi.fn(),
            },
            params: { id: 'machine-1' },
        }).module;
    });

    vi.mock('react-native-unistyles', async () => {
        const activeOptions = machineDetailsModuleState.options;
        if (activeOptions.unistyles) {
            return await activeOptions.unistyles();
        }
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock();
    });

    vi.mock('@/text', async () => {
        const activeOptions = machineDetailsModuleState.options;
        if (activeOptions.text) {
            return await activeOptions.text();
        }
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    });

    vi.mock('@/modal', async () => {
        const activeOptions = machineDetailsModuleState.options;
        if (activeOptions.modal) {
            return await activeOptions.modal();
        }
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: vi.fn(),
                confirm: vi.fn(),
                prompt: vi.fn(),
                show: vi.fn(),
            },
        }).module;
    });
}
