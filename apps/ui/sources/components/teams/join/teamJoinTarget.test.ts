import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const homeFetch = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointSpy = vi.hoisted(() => vi.fn());
const acquireIrohHomeRuntimeOriginSpy = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>());
const irohReleaseSpy = vi.hoisted(() => vi.fn(async () => {}));
const resolveBrowserHostDecisionSpy = vi.hoisted(() => vi.fn());

// The Home's own answer to the public feature probe is the only genuine system
// boundary here: profiles, the identity owner, adoption and the resolver all
// stay real, so these tests fail if this module ever routes or adopts without
// that answer.
vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/http/client')>(),
    createServerFetchAtEndpoint: (input: unknown) => {
        createServerFetchAtEndpointSpy(input);
        return homeFetch;
    },
}));

// The native Iroh tunnel and the browser host decision are the other genuine
// boundaries. The carrier policy, the enrollment transport owner it composes and
// its verification rules all stay real below them.
vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireIrohHomeRuntimeOriginSpy(input),
}));
vi.mock('@/sync/runtime/browserIroh/hostEligibility', () => ({
    resolveBrowserIrohHostDecision: () => resolveBrowserHostDecisionSpy(),
}));

import { standardCleanup } from '@/dev/testkit';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import {
    listServerProfiles,
    resolveServerProfileForPortableIdentity,
    setServerProfileIdentityForUrl,
    upsertServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit';
import { createTeamInvitationTargetBindingV1 } from '@happier-dev/protocol/teams';

import { renderHook } from '@/dev/testkit/hooks/renderHook';
import {
    acquirePortableHomeLinkTarget,
    isTeamInvitationTargetBindingValidBeforeResolution,
    resolvePortableHomeLinkTarget,
    usePortableHomeLinkTarget,
    type PortableHomeLinkTargetState,
} from './teamJoinTarget';

const INVITATION_TOKEN = 'a'.repeat(43);

/** A current link: the Home's own strict descriptor, as the join producer emits it. */
function currentLinkCarrier(params: Readonly<{
    homeServerIdentityId: string;
    canonicalServerUrl: string;
}>): string {
    return JSON.stringify({
        kind: 'descriptor',
        authority: 'trusted_enrollment',
        descriptor: {
            v: 1,
            homeServerIdentityId: params.homeServerIdentityId,
            canonicalServerUrl: params.canonicalServerUrl,
            revision: 1,
            endpoints: [{ kind: 'https', url: params.canonicalServerUrl }],
        },
    });
}

function answerFeatureProbeAs(serverIdentityId: string | null): void {
    const features = createRootLayoutFeaturesResponse();
    (features.capabilities as { serverIdentity: { serverIdentityId: string | null } })
        .serverIdentity = { serverIdentityId };
    homeFetch.mockResolvedValue(new Response(JSON.stringify(features), {
        headers: { 'content-type': 'application/json' },
    }));
}

beforeEach(() => {
    homeFetch.mockReset();
    createServerFetchAtEndpointSpy.mockReset();
    acquireIrohHomeRuntimeOriginSpy.mockReset();
    irohReleaseSpy.mockClear();
    resolveBrowserHostDecisionSpy.mockReset();
    resolveBrowserHostDecisionSpy.mockReturnValue({ eligible: false, reason: 'not_web' });
    resetServerFeaturesClientForTests();
});

afterEach(async () => {
    await standardCleanup();
    resetServerFeaturesClientForTests();
});

/** A saved Home whose device-local profile id differs from its portable identity. */
async function addHome(serverUrl: string, identity: string): Promise<Readonly<{ profileId: string }>> {
    const profile = await upsertServerProfile({ serverUrl, name: serverUrl });
    await setServerProfileIdentityForUrl(serverUrl, identity);
    return { profileId: profile.id };
}

describe('resolvePortableHomeLinkTarget', () => {
    it('keeps an unobserved descriptor target unrouted while retaining it for acquisition', () => {
        const carrier = currentLinkCarrier({
            homeServerIdentityId: 'srv_fresh_home',
            canonicalServerUrl: 'https://fresh-home.example',
        });

        const target = resolvePortableHomeLinkTarget(carrier);

        // Fail-closed for routing — nothing may be sent yet — but the Home's own
        // validated descriptor survives, because discarding it is what strands a
        // fresh device with no way back to the Home the link named.
        expect(target).toMatchObject({
            kind: 'acquisition_required',
            homeServerIdentityId: 'srv_fresh_home',
            descriptor: {
                homeServerIdentityId: 'srv_fresh_home',
                canonicalServerUrl: 'https://fresh-home.example',
                endpoints: [{ kind: 'https', url: 'https://fresh-home.example' }],
            },
        });
    });

    it('routes the portable Home identity the link carries to its saved profile', async () => {
        const { profileId } = await addHome('https://acme-home.example', 'srv_acme_home');
        await addHome('https://other-home.example', 'srv_other_home');

        const target = resolvePortableHomeLinkTarget('srv_acme_home');

        expect(target).toEqual({
            kind: 'resolved',
            serverId: profileId,
            target: { kind: 'saved_profile', profileRef: profileId },
        });
    });

    it('does not treat the carrier as a device-local profile id', async () => {
        // The profile id is local routing storage. A link carrying one — whether
        // by a producer mistake or by an attacker naming a profile id it guessed —
        // is not the Home's portable identity and must not select a target.
        const { profileId } = await addHome('https://acme-home.example', 'srv_acme_home');

        expect(resolvePortableHomeLinkTarget(profileId).kind).not.toBe('resolved');
    });

    it('reports a well-formed identity this device has not adopted as a recoverable unknown Home', async () => {
        await addHome('https://acme-home.example', 'srv_acme_home');

        expect(resolvePortableHomeLinkTarget('srv_home_elsewhere')).toEqual({
            kind: 'unknown_home',
            homeServerIdentityId: 'srv_home_elsewhere',
        });
    });

    it('never selects the only saved Home, or any Home, without a carrier', async () => {
        await addHome('https://acme-home.example', 'srv_acme_home');

        for (const carrier of [null, undefined, '', '   ']) {
            expect(resolvePortableHomeLinkTarget(carrier)).toEqual({ kind: 'unresolved' });
        }
    });
});

describe('acquirePortableHomeLinkTarget', () => {
    const CARRIER = currentLinkCarrier({
        homeServerIdentityId: 'srv_fresh_home',
        canonicalServerUrl: 'https://fresh-home.example',
    });

    function acquisitionRequest() {
        const resolved = resolvePortableHomeLinkTarget(CARRIER);
        if (resolved.kind !== 'acquisition_required') throw new Error(`unexpected ${resolved.kind}`);
        return resolved;
    }

    it('admits an exact bound HTTPS carrier before acquisition', () => {
        expect(isTeamInvitationTargetBindingValidBeforeResolution({
            token: INVITATION_TOKEN,
            carrier: CARRIER,
            binding: createTeamInvitationTargetBindingV1({
                token: INVITATION_TOKEN,
                homeTarget: CARRIER,
            }),
        })).toBe(true);
    });

    it('adopts the exact Home once it answers with the identity the link named', async () => {
        answerFeatureProbeAs('srv_fresh_home');

        const outcome = await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(outcome).toEqual({
            kind: 'acquired',
            serverId: expect.any(String),
            target: { kind: 'saved_profile', profileRef: expect.any(String) },
        });
        // The acquisition is only useful if the very same link now routes, in
        // place, without the person leaving the mounted invitation.
        expect(resolvePortableHomeLinkTarget(CARRIER)).toEqual({
            kind: 'resolved',
            serverId: (outcome as { serverId: string }).serverId,
            target: { kind: 'saved_profile', profileRef: (outcome as { serverId: string }).serverId },
        });
    });

    it('establishes nothing when the named endpoints answer as a different Home', async () => {
        answerFeatureProbeAs('srv_impostor_home');

        const outcome = await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(outcome).toEqual({ kind: 'rejected', reason: 'identity_mismatch' });
        expect(listServerProfiles().some((profile) => (
            profile.serverIdentityId === 'srv_fresh_home' || profile.serverUrl === 'https://fresh-home.example'
        ))).toBe(false);
        expect(resolveServerProfileForPortableIdentity('srv_fresh_home').kind).toBe('missing');
        expect(resolvePortableHomeLinkTarget(CARRIER).kind).toBe('acquisition_required');
    });

    it('establishes nothing when the named Home cannot be observed at all', async () => {
        homeFetch.mockRejectedValue(new Error('offline'));

        const outcome = await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(outcome).toEqual({ kind: 'rejected', reason: 'unreachable' });
        expect(listServerProfiles().some((profile) => (
            profile.serverIdentityId === 'srv_fresh_home' || profile.serverUrl === 'https://fresh-home.example'
        ))).toBe(false);
        expect(resolveServerProfileForPortableIdentity('srv_fresh_home').kind).toBe('missing');
    });

    it('presents no credential to the Home it is still verifying', async () => {
        answerFeatureProbeAs('srv_fresh_home');

        await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(homeFetch).toHaveBeenCalled();
        // The bearer lives in the mounted route, and the verification request is
        // the unauthenticated public feature projection. Anything else would tell
        // an unverified endpoint the secret it is being asked to prove it owns.
        for (const call of homeFetch.mock.calls) {
            expect(String(call[0])).toBe('/v1/features');
            expect(JSON.stringify(call[1] ?? {})).not.toContain('Authorization');
            expect(call[2]).toMatchObject({ includeAuth: false });
        }
    });

    it('reaches a saved HTTPS Home over its descriptor-declared application origin', async () => {
        answerFeatureProbeAs('srv_fresh_home');

        await acquirePortableHomeLinkTarget(acquisitionRequest());

        // The predecessor HTTPS case keeps its stable canonical audience and
        // acquires no runtime carrier at all.
        expect(createServerFetchAtEndpointSpy).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://fresh-home.example',
            runtimeOrigin: 'https://fresh-home.example',
        }));
        expect(acquireIrohHomeRuntimeOriginSpy).not.toHaveBeenCalled();
    });
});

/**
 * A Personal Home is routinely Iroh-only and publishes a loopback canonical URL.
 * Reading an endpoint out of the descriptor sends a remote device's observation
 * to its own machine, so these cases are what prove the link goes through the
 * canonical enrollment transport owner instead.
 */
describe('acquirePortableHomeLinkTarget over an Iroh-only Home', () => {
    const ENDPOINT_ID = 'a'.repeat(64);
    const LOOPBACK_CARRIER = JSON.stringify({
        kind: 'descriptor',
        authority: 'trusted_enrollment',
        descriptor: {
            v: 1,
            homeServerIdentityId: 'srv_personal_home',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 4,
            endpoints: [{ kind: 'iroh', endpointId: ENDPOINT_ID }],
        },
    });

    function acquisitionRequest() {
        const resolved = resolvePortableHomeLinkTarget(LOOPBACK_CARRIER);
        if (resolved.kind !== 'acquisition_required') throw new Error(`unexpected ${resolved.kind}`);
        return resolved;
    }

    it('admits an exact bound Iroh carrier before acquisition', () => {
        expect(isTeamInvitationTargetBindingValidBeforeResolution({
            token: INVITATION_TOKEN,
            carrier: LOOPBACK_CARRIER,
            binding: createTeamInvitationTargetBindingV1({
                token: INVITATION_TOKEN,
                homeTarget: LOOPBACK_CARRIER,
            }),
        })).toBe(true);
    });

    function acquireVerifiedLease(): void {
        acquireIrohHomeRuntimeOriginSpy.mockResolvedValue({
            leaseId: 'lease-personal-home',
            localUrl: 'http://127.0.0.1:43123',
            runtimeOrigin: 'http://127.0.0.1:43123',
            homeServerIdentityId: 'srv_personal_home',
            endpointId: ENDPOINT_ID,
            carrier: 'iroh',
            observedPath: 'relay',
            status: 'ready',
            release: irohReleaseSpy,
        });
    }

    it('adopts the Home over its verified Iroh carrier and releases it afterwards', async () => {
        acquireVerifiedLease();
        answerFeatureProbeAs('srv_personal_home');

        const outcome = await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(acquireIrohHomeRuntimeOriginSpy).toHaveBeenCalledTimes(1);
        // The observation must travel over the acquired carrier's loopback origin
        // while the stable canonical URL remains the request audience. Probing the
        // canonical loopback URL directly is what strands every remote device.
        expect(createServerFetchAtEndpointSpy).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: 'http://127.0.0.1:43123',
        }));
        expect(outcome).toMatchObject({ kind: 'acquired' });
        expect(resolvePortableHomeLinkTarget(LOOPBACK_CARRIER)).toMatchObject({ kind: 'resolved' });
        // A carrier is a live runtime resource held only for this observation.
        expect(irohReleaseSpy).toHaveBeenCalledTimes(1);
    });

    it('adopts nothing when the Iroh-reachable endpoints answer as a different Home', async () => {
        acquireVerifiedLease();
        answerFeatureProbeAs('srv_impostor_home');

        const outcome = await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(outcome).toEqual({ kind: 'rejected', reason: 'identity_mismatch' });
        expect(resolveServerProfileForPortableIdentity('srv_personal_home').kind).toBe('missing');
        expect(listServerProfiles().some((profile) => profile.serverUrl === 'http://localhost:3010')).toBe(false);
        expect(irohReleaseSpy).toHaveBeenCalledTimes(1);
    });

    it('stays effect-free and retryable when no carrier can be acquired', async () => {
        acquireIrohHomeRuntimeOriginSpy.mockRejectedValue(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );

        const outcome = await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(outcome).toEqual({ kind: 'rejected', reason: 'unreachable' });
        // Without a carrier there is nowhere legitimate to ask, so the canonical
        // loopback URL must not be probed as a consolation target.
        expect(createServerFetchAtEndpointSpy).not.toHaveBeenCalled();
        expect(homeFetch).not.toHaveBeenCalled();
        expect(resolveServerProfileForPortableIdentity('srv_personal_home').kind).toBe('missing');
        // The same link is still acquirable, so the surface's retry is real.
        expect(resolvePortableHomeLinkTarget(LOOPBACK_CARRIER).kind).toBe('acquisition_required');
    });

    it('releases the carrier when the Home it acquired never answers', async () => {
        acquireVerifiedLease();
        homeFetch.mockRejectedValue(new Error('offline'));

        const outcome = await acquirePortableHomeLinkTarget(acquisitionRequest());

        expect(outcome).toEqual({ kind: 'rejected', reason: 'unreachable' });
        expect(resolveServerProfileForPortableIdentity('srv_personal_home').kind).toBe('missing');
        expect(irohReleaseSpy).toHaveBeenCalledTimes(1);
    });
});

/**
 * A legacy link names a Home by identity alone. On a device that has not added
 * that Home the answer is `unknown_home`, whose only remedy is adding it — so
 * adding it must re-resolve the very link that is still open.
 */
describe('usePortableHomeLinkTarget when the missing Home is added', () => {
    it('re-resolves the unchanged carrier through the profiles owner', async () => {
        const harness = await renderHook(
            (carrier: string | null) => usePortableHomeLinkTarget(carrier),
            { initialProps: 'srv_added_later' as string | null },
        );

        expect(harness.getCurrent()).toEqual({
            kind: 'unknown_home',
            homeServerIdentityId: 'srv_added_later',
        });

        const added = await addHome('https://added-later.example', 'srv_added_later');
        const resolved = await harness.rerender('srv_added_later');

        expect(resolved).toEqual({
            kind: 'resolved',
            serverId: added.profileId,
            target: { kind: 'saved_profile', profileRef: added.profileId },
        });
    });

    it('keeps one resolution identity while unrelated Homes are added', async () => {
        const added = await addHome('https://stable-home.example', 'srv_stable_home');
        const harness = await renderHook(
            (carrier: string | null) => usePortableHomeLinkTarget(carrier),
            { initialProps: 'srv_stable_home' as string | null },
        );
        const first = harness.getCurrent();
        expect(first).toEqual({
            kind: 'resolved',
            serverId: added.profileId,
            target: { kind: 'saved_profile', profileRef: added.profileId },
        });

        await addHome('https://unrelated-home.example', 'srv_unrelated_home');

        // Consumers key effects and requests off this value, so an answer that did
        // not change must stay referentially identical.
        expect(await harness.rerender('srv_stable_home')).toBe(first);
    });
});

/**
 * A mounted portable-link route can receive a second link as an in-place param
 * update. The acquired target of the previous carrier must never be published
 * for the new one: consumers dispatch their bearer-carrying request from the
 * first render after the change, before any reset effect can run.
 */
describe('usePortableHomeLinkTarget across a carrier change', () => {
    const ENDPOINT_ID = 'b'.repeat(64);
    const FIRST_CARRIER = JSON.stringify({
        kind: 'descriptor',
        authority: 'trusted_enrollment',
        descriptor: {
            v: 1,
            homeServerIdentityId: 'srv_first_home',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: ENDPOINT_ID }],
        },
    });
    const SECOND_CARRIER = currentLinkCarrier({
        homeServerIdentityId: 'srv_second_home',
        canonicalServerUrl: 'https://second-home.example',
    });

    it('never publishes the previous Home target for the new carrier', async () => {
        acquireIrohHomeRuntimeOriginSpy.mockResolvedValue({
            leaseId: 'lease-first-home',
            localUrl: 'http://127.0.0.1:43123',
            runtimeOrigin: 'http://127.0.0.1:43123',
            homeServerIdentityId: 'srv_first_home',
            endpointId: ENDPOINT_ID,
            carrier: 'iroh',
            observedPath: 'relay',
            status: 'ready',
            release: irohReleaseSpy,
        });
        answerFeatureProbeAs('srv_first_home');

        const rendered: PortableHomeLinkTargetState[] = [];
        const harness = await renderHook((carrier: string | null) => {
            const value = usePortableHomeLinkTarget(carrier);
            rendered.push(value);
            return value;
        }, { initialProps: FIRST_CARRIER as string | null });

        // Acquisition is asynchronous; let it settle before the carrier changes.
        for (let attempt = 0; attempt < 20 && harness.getCurrent().kind !== 'resolved'; attempt += 1) {
            await harness.rerender(FIRST_CARRIER);
        }
        const firstTarget = harness.getCurrent();
        expect(firstTarget.kind).toBe('resolved');
        const firstServerId = firstTarget.kind === 'resolved' ? firstTarget.serverId : null;
        expect(firstServerId).toBeTruthy();

        rendered.length = 0;
        await harness.rerender(SECOND_CARRIER);

        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.some((value) => value.kind === 'resolved' && value.serverId === firstServerId)).toBe(false);
        expect(rendered[0]?.kind).toBe('acquiring');
    });
});
