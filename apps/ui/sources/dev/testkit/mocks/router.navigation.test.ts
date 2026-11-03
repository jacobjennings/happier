import { describe, expect, it } from 'vitest';
import { createExpoRouterMock } from './router';

describe('Expo navigation boundary', () => {
    it('supplies the navigator through the default Expo Router loader alias', async () => {
        const router = await import('expo-router');
        expect(router.useNavigation()).toMatchObject({ setOptions: expect.any(Function) });
    });

    it('supplies the navigator when no override was requested', () => {
        const navigator = createExpoRouterMock().module.useNavigation();
        expect(navigator).toMatchObject({ setOptions: expect.any(Function) });
    });

    it('keeps an explicitly absent navigator absent', () => {
        expect(createExpoRouterMock({ navigation: null }).module.useNavigation()).toBeNull();
    });
});
