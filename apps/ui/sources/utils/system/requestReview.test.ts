import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeReview = vi.hoisted(() => ({
    isAvailableAsync: vi.fn(async () => true),
    requestReview: vi.fn(async () => {}),
}));
vi.mock('expo-store-review', () => storeReview);

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios' } });
});

// Analytics egress (PostHog behind @/track): observe the event without loading the
// real tracking client and its persisted-settings chain.
const trackReviewStoreShown = vi.hoisted(() => vi.fn());
vi.mock('@/track', () => ({ trackReviewStoreShown }));

import { requestReview } from './requestReview';

async function flushMicrotasks(iterations: number = 5): Promise<void> {
    for (let i = 0; i < iterations; i += 1) {
        await Promise.resolve();
    }
}

describe('requestReview', () => {
    const previousDeny = process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;

    beforeEach(() => {
        storeReview.isAvailableAsync.mockClear();
        storeReview.requestReview.mockClear();
        trackReviewStoreShown.mockClear();
        delete process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
    });

    afterEach(() => {
        if (previousDeny === undefined) delete process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY;
        else process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = previousDeny;
    });

    it('does not attempt store review when build policy denies store review prompts', async () => {
        process.env.EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_DENY = 'app.ui.storeReviewPrompts';

        requestReview();
        await flushMicrotasks();

        expect(storeReview.isAvailableAsync).not.toHaveBeenCalled();
        expect(storeReview.requestReview).not.toHaveBeenCalled();
        expect(trackReviewStoreShown).not.toHaveBeenCalled();
    });

    it('requests the store review directly and records that the store sheet was shown', async () => {
        requestReview();
        await flushMicrotasks();

        expect(storeReview.requestReview).toHaveBeenCalledTimes(1);
        expect(trackReviewStoreShown).toHaveBeenCalledTimes(1);
        expect(storeReview.requestReview.mock.invocationCallOrder[0])
            .toBeLessThan(trackReviewStoreShown.mock.invocationCallOrder[0]);
    });
});
