import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'web' as string }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() { return platform.OS; },
        },
    });
});

import { navigateWithBlurOnWeb } from './navigateWithBlurOnWeb';

describe('navigateWithBlurOnWeb', () => {
    afterEach(() => {
        platform.OS = 'web';
        vi.unstubAllGlobals();
    });

    it('blurs the active element before running the navigation action on web', () => {
        const blurSpy = vi.fn();
        vi.stubGlobal('document', { activeElement: { blur: blurSpy } });
        const actionSpy = vi.fn();

        navigateWithBlurOnWeb(actionSpy);

        expect(blurSpy).toHaveBeenCalledTimes(1);
        expect(actionSpy).toHaveBeenCalledTimes(1);
        expect(blurSpy.mock.invocationCallOrder[0]).toBeLessThan(actionSpy.mock.invocationCallOrder[0]);
    });

    it('runs the navigation action without trying to blur on native', () => {
        platform.OS = 'ios';
        const blurSpy = vi.fn();
        vi.stubGlobal('document', { activeElement: { blur: blurSpy } });
        const actionSpy = vi.fn();

        navigateWithBlurOnWeb(actionSpy);

        expect(actionSpy).toHaveBeenCalledTimes(1);
        expect(blurSpy).not.toHaveBeenCalled();
    });
});
