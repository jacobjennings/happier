import { vi } from 'vitest';

type AccountSettingsRouteModuleFactory = () => unknown | Promise<unknown>;
type AccountSettingsRouteImportOriginal = <T = unknown>() => Promise<T>;
type AccountSettingsRouteStorageModuleFactory = (
    importOriginal: AccountSettingsRouteImportOriginal,
) => object | Promise<object>;

type InstallAccountSettingsRouteModuleMocksOptions = Readonly<{
    routerModule?: AccountSettingsRouteModuleFactory;
    storageModule?: AccountSettingsRouteStorageModuleFactory;
}>;

const accountSettingsRouteModuleState = vi.hoisted(() => ({
    routerMockRef: { current: null as unknown },
    options: {
        routerModule: undefined as AccountSettingsRouteModuleFactory | undefined,
        storageModule: undefined as AccountSettingsRouteStorageModuleFactory | undefined,
    },
}));

export function getAccountSettingsRouteRouterMockRef() {
    return accountSettingsRouteModuleState.routerMockRef as { current: any };
}

export function installAccountSettingsRouteModuleMocks(
    options: InstallAccountSettingsRouteModuleMocksOptions = {},
) {
    accountSettingsRouteModuleState.options = {
        routerModule: options.routerModule,
        storageModule: options.storageModule,
    };

    vi.mock('expo-router', async () => {
        if (accountSettingsRouteModuleState.options.routerModule) {
            return await accountSettingsRouteModuleState.options.routerModule();
        }
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock();
        accountSettingsRouteModuleState.routerMockRef.current = routerMock;
        return routerMock.module;
    });

    vi.mock('@/text', async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock();
    });

    vi.mock('@/modal', async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock().module;
    });

    if (options.storageModule) {
        const storageModule = options.storageModule;
        vi.doMock('@/sync/domains/state/storage', (importOriginal) =>
            storageModule(importOriginal as AccountSettingsRouteImportOriginal));
    }
}
