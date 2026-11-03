import { describe, expect, it, vi } from 'vitest';

import { applyInitialAppStateConnectivityGate } from './appStateConnectivityGate';

describe('applyInitialAppStateConnectivityGate', () => {
    it.each([
        { isForeground: false, networkAllowed: false, pauseCalls: 1 },
        { isForeground: true, networkAllowed: true, pauseCalls: 0 },
    ])('foreground=$isForeground sets network allowed=$networkAllowed and pauses $pauseCalls time(s)', ({ isForeground, networkAllowed, pauseCalls }) => {
        const pause = vi.fn();
        const setNetworkAllowed = vi.fn();

        applyInitialAppStateConnectivityGate({
            isForeground,
            pauseController: { pause },
            setNetworkAllowed,
        });

        expect(setNetworkAllowed).toHaveBeenCalledWith(networkAllowed);
        expect(pause).toHaveBeenCalledTimes(pauseCalls);
    });
});
