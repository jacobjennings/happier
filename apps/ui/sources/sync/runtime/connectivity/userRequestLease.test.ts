import { describe, expect, it, vi } from 'vitest';

import { createUserRequestLeaseOwner } from './userRequestLease';

describe('user request lease owner', () => {
    it('defers routine hidden teardown until every in-flight user request settles', () => {
        const owner = createUserRequestLeaseOwner();
        const firstRelease = owner.acquire();
        const secondRelease = owner.acquire();
        const teardown = vi.fn();

        expect(owner.deferRoutineTeardown(teardown)).toBe(true);
        expect(teardown).not.toHaveBeenCalled();

        firstRelease();
        expect(teardown).not.toHaveBeenCalled();

        secondRelease();
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(owner.hasActiveLease()).toBe(false);
    });

    it('cancels deferred hidden teardown when visibility returns', () => {
        const owner = createUserRequestLeaseOwner();
        const release = owner.acquire();
        const teardown = vi.fn();

        owner.deferRoutineTeardown(teardown);
        owner.cancelDeferredRoutineTeardown();
        release();

        expect(teardown).not.toHaveBeenCalled();
    });

    it('treats a hard boundary (pagehide/freeze) as tearing down immediately', () => {
        const owner = createUserRequestLeaseOwner();
        const release = owner.acquire();
        const routineTeardown = vi.fn();
        const hardTeardown = vi.fn();

        owner.deferRoutineTeardown(routineTeardown);
        owner.crossHardBoundary(hardTeardown);

        expect(hardTeardown).toHaveBeenCalledTimes(1);
        expect(routineTeardown).not.toHaveBeenCalled();
        expect(owner.hasActiveLease()).toBe(false);

        release();
        expect(hardTeardown).toHaveBeenCalledTimes(1);
    });

    it('does not let a retired request release a replacement request across a hard boundary', () => {
        const owner = createUserRequestLeaseOwner();
        const releaseRetired = owner.acquire();
        owner.crossHardBoundary(() => {});
        const releaseCurrent = owner.acquire();
        const teardown = vi.fn();
        owner.deferRoutineTeardown(teardown);

        releaseRetired();
        expect(teardown).not.toHaveBeenCalled();
        expect(owner.hasActiveLease()).toBe(true);

        releaseCurrent();
        expect(teardown).toHaveBeenCalledOnce();
    });
});
