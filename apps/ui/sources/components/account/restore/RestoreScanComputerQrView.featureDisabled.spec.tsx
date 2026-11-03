import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installRestoreScanComputerQrViewCommonModuleMocks } from './restoreScanComputerQrViewTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

installRestoreScanComputerQrViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            ScrollView: 'ScrollView',
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'ios',
                select: (options: any) => options?.ios ?? options?.default ?? options?.web ?? options?.android,
            },
        });
    },
});

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'disabled' }),
}));

let scannerRendered = false;
vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => {
        scannerRendered = true;
        return React.createElement('QrCodeScannerView', props);
    },
}));

const { InjectedAuthProvider } = await import('@/auth/context/AuthContext');
const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

describe('RestoreScanComputerQrView (feature disabled)', () => {
    it('renders a fallback UX instead of the scanner', async () => {
        scannerRendered = false;

        const screen = await renderScreen(<InjectedAuthProvider credentials={null}>
            <RestoreScanComputerQrView entryIntent="add_home" />
        </InjectedAuthProvider>);

        expect(scannerRendered).toBe(false);
        expect(screen.getTextContent()).toContain('connect.scanComputerQrUnavailableBody');
        expect(screen.findByTestId('restore-open-manual')).not.toBeNull();
        expect(screen.findByTestId('restore-show-qr-instead')).toBeNull();
    });
});
