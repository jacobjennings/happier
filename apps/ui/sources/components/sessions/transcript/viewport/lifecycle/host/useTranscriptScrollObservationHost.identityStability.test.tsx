// @vitest-environment jsdom

/**
 * Identity-stability contract for the M6 scroll observation host.
 *
 * The host receives a fresh deps object from ChatList during normal renders. Returned shell
 * callbacks and interaction props must stay stable when the individual dependency fields are
 * unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestSessionTranscriptSource, renderHookWithSessionTranscriptSource } from '@/dev/testkit';
import type { RenderHookOptions } from '@/dev/testkit/hooks/renderHook';
import type { WebTranscriptScrollMetrics } from '@/components/sessions/transcript/webTranscriptScrollMetrics';
import { createTranscriptUserScrollIntentOwner } from '@/components/sessions/transcript/viewport/driver/userScrollIntentOwner';
import { createEntryRestoreOwner } from '@/components/sessions/transcript/viewport/entryRestore/entryRestoreOwner';
import { createTranscriptLifecycleHost } from '@/components/sessions/transcript/viewport/lifecycle/lifecycleHost';
import type { TranscriptViewportOwner } from '@/components/sessions/transcript/viewport/transcriptViewportTypes';

import { useTranscriptScrollObservationHost } from './useTranscriptScrollObservationHost';

type ScrollObservationHostDeps = Parameters<typeof useTranscriptScrollObservationHost>[0];

function renderHook<Value>(
    useValue: (deps: ScrollObservationHostDeps) => Value,
    options: RenderHookOptions<ScrollObservationHostDeps>,
) {
    return renderHookWithSessionTranscriptSource(useValue, {
        ...options,
        source: createTestSessionTranscriptSource({ sessionId: options.initialProps.sessionId }),
    });
}

function createRef<T>(current: T): { current: T } {
    return { current };
}

function createScrollElement(): HTMLElement {
    return {
        clientHeight: 600,
        scrollHeight: 1200,
        scrollTop: 600,
    } as unknown as HTMLElement;
}

type ScrollObservationHostMembers = Omit<
    ScrollObservationHostDeps,
    | 'isLoaded'
    | 'isWarmKeepAliveInstance'
    | 'latestCommittedActivityKey'
    | 'nativeMountSettleStable'
    | 'pinEnabled'
    | 'pinThresholdPx'
    | 'platformOS'
    | 'routeJumpSeq'
    | 'sessionActive'
    | 'sessionId'
    | 'showFirstPaintPlaceholder'
    | 'userIntentRecentMs'
>;
type Deps = ScrollObservationHostDeps;

function createStableMembers() {
    const lifecycleHost = createTranscriptLifecycleHost();
    const userScrollIntent = createTranscriptUserScrollIntentOwner();
    return {
        activeTargetWindowTargetRef: createRef<Deps['activeTargetWindowTargetRef']['current']>(null),
        applyBlankRecoveryEffects: vi.fn(),
        applyEntryRestoreOwnerEffects: vi.fn(),
        applyNativeBottomFollowCompletionHostEffects: vi.fn(),
        applyNativeDragActiveMirrorEffectsRef: createRef<Deps['applyNativeDragActiveMirrorEffectsRef']['current']>(() => {}),
        applyNativeUserScrollTakeoverHostEffects: vi.fn(),
        bottomFollowModeStateRef: createRef<Deps['bottomFollowModeStateRef']['current']>({ dragSession: null, mode: 'following' }),
        commitBottomFollowModeState: vi.fn(),
        commitJumpToBottomDistanceForVisibility: vi.fn(),
        commitScrollPinEvent: vi.fn(),
        commitScrollPinState: vi.fn(),
        composerInsetHeightRef: createRef(0),
        currentSessionIdRef: createRef('s1'),
        deferViewportAnchorCapture: vi.fn(),
        dispatchViewportLifecycleEvent: vi.fn<Deps['dispatchViewportLifecycleEvent']>(() => ({
            effects: [],
            state: lifecycleHost.getState(),
        })),
        emitViewportChange: vi.fn(),
        entryRestoreOwner: createEntryRestoreOwner(),
        firstPaintTelemetryRef: createRef<Deps['firstPaintTelemetryRef']['current']>({ recorded: true }),
        getBottomFollowGestureActiveRef: createRef(() => false),
        hasNativeContentMeasurementForCurrentSession: vi.fn(() => false),
        hasNativeInitialViewportAppliedForCurrentSession: vi.fn(() => false),
        invalidateViewportAnchorCapture: vi.fn(),
        lastExplicitWebScrollIntentAtMsRef: createRef(Number.NEGATIVE_INFINITY),
        lastPinOffsetForIntentRef: createRef<number | null>(null),
        lastRouteJumpProtectionClearingWebMovementAtMsRef: createRef(Number.NEGATIVE_INFINITY),
        lastScrollOffsetForIntentRef: createRef<number | null>(null),
        lastUserScrollIntentAtMsRef: userScrollIntent.timestampRef,
        lifecycleHost,
        listContentHeightRef: createRef(0),
        listDataRef: createRef<Deps['listDataRef']['current']>([]),
        listLayoutHeightRef: createRef(0),
        listRef: createRef<Deps['listRef']['current']>(null),
        loadOlderInFlightRef: createRef(false),
        markNativeInitialViewportAppliedForCurrentSession: vi.fn(),
        measurementHost: {
            observeContentSizeChange: vi.fn<Deps['measurementHost']['observeContentSizeChange']>(() => ({ status: 'ignored' })),
        },
        nativeBottomFollowRearmedAfterDragRef: createRef(false),
        nativeListDragActiveRef: createRef(false),
        nativeMomentumScrollActiveRef: createRef(false),
        nativeMountSettleDeadlineReachedRef: createRef(false),
        nativePrependTelemetryStateRef: createRef<Deps['nativePrependTelemetryStateRef']['current']>(() => 'none'),
        nativeTranscriptTouchStartYRef: createRef<number | null>(null),
        observeMountSettleMetrics: vi.fn(),
        observeNativeBlankRecovery: vi.fn(),
        observeNativeConfirmation: vi.fn(() => false),
        observeNativeEntryRestoreHostFacts: vi.fn<Deps['observeNativeEntryRestoreHostFacts']>(() => []),
        observeNativePrependOwner: vi.fn(),
        observeTranscriptNavigationVisibility: vi.fn(),
        olderPagination: {
            getSnapshot: vi.fn<Deps['olderPagination']['getSnapshot']>(() => ({
                hasMore: false,
                insideThreshold: false,
                loadFailed: false,
                phase: 'idle',
                suspendedReasons: [],
            })),
            isNearOlderEdge: vi.fn(() => false),
            isReadyForLoad: vi.fn(() => true),
            onScrollObservation: vi.fn(),
        },
        pendingJumpSeqViewportPromotionRef: createRef<unknown>(null),
        pinEnabledRef: createRef(true),
        pinThresholdPxRef: createRef(72),
        preemptExplicitJumpForUserTakeover: vi.fn(),
        preemptEntryRestoreTransaction: vi.fn(),
        prependHost: {
            applyNativeEffects: vi.fn(),
            armNativeCommit: vi.fn(),
            beginNativeTransaction: vi.fn(() => false),
            getNativeTransactionRevision: vi.fn(() => 0),
            hasOpenNativeTransaction: vi.fn(() => false),
            invalidateNativeTransaction: vi.fn(),
            nativeTelemetryState: vi.fn<Deps['prependHost']['nativeTelemetryState']>(() => 'none'),
            observeNative: vi.fn(),
            recordCorrectorCorrection: vi.fn(),
            trustedNativeScroll: vi.fn<Deps['prependHost']['trustedNativeScroll']>(() => []),
        },
        promotedJumpSeqViewportProtectionRef: createRef<Deps['promotedJumpSeqViewportProtectionRef']['current']>(null),
        promotePendingJumpSeqViewportSnapshot: vi.fn(() => false),
        readCurrentNativeDistanceFromBottom: vi.fn<Deps['readCurrentNativeDistanceFromBottom']>(() => null),
        recordFirstListPaint: vi.fn(),
        recordListLayoutWidth: vi.fn(),
        recordNativeVisibleWindowTelemetry: vi.fn(),
        recordScrollObservedTelemetry: vi.fn(),
        recordStablePaintTelemetry: vi.fn(),
        recordViewportTelemetryEvent: vi.fn(),
        readItemsToNewerEdge: vi.fn<() => number | null>(() => null),
        readItemsToOlderEdge: vi.fn<() => number | null>(() => null),
        resolveEffectiveListPaintMetrics: vi.fn<Deps['resolveEffectiveListPaintMetrics']>(() => null),
        resolveNativeObservedScrollOffset: vi.fn<Deps['resolveNativeObservedScrollOffset']>(() => null),
        resolveTranscriptMountSettleBottomDistanceNoiseFloorPx: vi.fn<Deps['resolveTranscriptMountSettleBottomDistanceNoiseFloorPx']>(() => null),
        resolveViewportReachedEdge: vi.fn<Deps['resolveViewportReachedEdge']>((edge) => edge === 'start' ? 'older' : 'newer'),
        resolveViewportTelemetryMode: vi.fn<Deps['resolveViewportTelemetryMode']>(() => 'follow-bottom'),
        resolveWebScrollMetrics: vi.fn<() => WebTranscriptScrollMetrics | null>(() => null),
        resolveWebViewportTelemetryDiagnostics: vi.fn<Deps['resolveWebViewportTelemetryDiagnostics']>(() => ({})),
        runEntryRestoreAttempt: vi.fn(),
        scheduleViewportAnchorCaptureRef: createRef<Deps['scheduleViewportAnchorCaptureRef']['current']>(() => {}),
        scrollPinRef: createRef<Deps['scrollPinRef']['current']>({ isPinned: true, lastActivityKey: null, newActivityCount: 0 }),
        sessionEntryViewportRef: createRef<Deps['sessionEntryViewportRef']['current']>(null),
        setListContentHeight: vi.fn(),
        setListLayoutHeight: vi.fn(),
        shouldCommitContentHeightState: vi.fn(() => true),
        shouldIgnoreNativeInvalidScrollObservation: vi.fn(() => false),
        shouldSuppressGenericViewportStateForProtectedJumpSeq: vi.fn(() => false),
        targetWindowActiveRef: createRef(false),
        targetWindowEdgeLoadInFlightRef: createRef<'newer' | 'older' | null>(null),
        targetWindowHostFacts: { activeWindowState: null },
        updateNativeInitialViewportPendingObservation: vi.fn(),
        updateNativeViewportPaintObserved: vi.fn(),
        userScrollIntent,
        viewportCommandController: { activeOwner: vi.fn<() => TranscriptViewportOwner>(() => 'follow') },
        wantsPinnedRef: createRef(true),
        verifyWebEntryRestoreTransaction: vi.fn(),
    } satisfies ScrollObservationHostMembers;
}

function buildDeps(members: ReturnType<typeof createStableMembers>): ScrollObservationHostDeps {
    return {
        ...members,
        isLoaded: false,
        isWarmKeepAliveInstance: false,
        latestCommittedActivityKey: 'activity-1',
        nativeMountSettleStable: false,
        pinEnabled: true,
        pinThresholdPx: 72,
        platformOS: 'web',
        routeJumpSeq: null,
        sessionActive: true,
        sessionId: 's1',
        showFirstPaintPlaceholder: false,
        userIntentRecentMs: 500,
    };
}

describe('useTranscriptScrollObservationHost identity stability', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('keeps shell callbacks and interaction props stable across fresh deps object identities', async () => {
        const members = createStableMembers();
        const hook = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: buildDeps(members) },
        );

        const first = hook.getCurrent();

        await hook.rerender(buildDeps(members));
        await hook.rerender(buildDeps(members));

        const second = hook.getCurrent();
        expect(second.onLayout).toBe(first.onLayout);
        expect(second.onContentSizeChange).toBe(first.onContentSizeChange);
        expect(second.onScroll).toBe(first.onScroll);
        expect(second.platformInteractionProps).toBe(first.platformInteractionProps);

        await hook.unmount();
    });

    it('re-evaluates ordinary older pagination after a committed projection at exact web top', async () => {
        const members = createStableMembers();
        const element = createScrollElement();
        Object.defineProperties(element, {
            scrollTop: { configurable: true, value: 0 },
            scrollHeight: { configurable: true, value: 1200 },
            clientHeight: { configurable: true, value: 600 },
        });
        members.resolveWebScrollMetrics.mockReturnValue({
            clientHeight: 600,
            element,
            scrollHeight: 1200,
            scrollTop: 0,
        });
        members.wantsPinnedRef.current = false;
        const hook = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: { ...buildDeps(members), isLoaded: true } },
        );

        hook.getCurrent().observeCommittedProjectionLayout();

        expect(members.olderPagination.onScrollObservation).toHaveBeenCalledWith({
            itemsToOlderEdge: null,
            offsetY: 0,
            scrollable: true,
            trigger: 'layout-committed',
        });
        await hook.unmount();
    });

    it('does not treat an unknown native committed visible range as edge or exit evidence', async () => {
        const members = createStableMembers();
        members.readItemsToOlderEdge.mockReturnValue(null);
        members.listContentHeightRef.current = 1200;
        members.listLayoutHeightRef.current = 600;
        members.listRef.current = {
            getAbsoluteLastScrollOffset: () => 0,
            scrollToIndex: vi.fn(),
            scrollToOffset: vi.fn(),
        };
        members.resolveNativeObservedScrollOffset.mockReturnValue({
            canonicalOffsetY: 0,
            distanceFromLiveTailPx: 600,
        });
        members.wantsPinnedRef.current = false;
        members.bottomFollowModeStateRef.current = { dragSession: null, mode: 'released' };
        const hook = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: { ...buildDeps(members), isLoaded: true, platformOS: 'ios' } },
        );
        members.olderPagination.onScrollObservation.mockClear();

        hook.getCurrent().observeCommittedProjectionLayout();

        expect(members.olderPagination.onScrollObservation).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('dispatches one captured native committed item-edge fact even if the live reader changes', async () => {
        const members = createStableMembers();
        members.readItemsToOlderEdge
            .mockReturnValueOnce(0)
            .mockReturnValue(null);
        members.listContentHeightRef.current = 1200;
        members.listLayoutHeightRef.current = 600;
        members.listRef.current = {
            getAbsoluteLastScrollOffset: () => 0,
            scrollToIndex: vi.fn(),
            scrollToOffset: vi.fn(),
        };
        members.resolveNativeObservedScrollOffset.mockReturnValue({
            canonicalOffsetY: 0,
            distanceFromLiveTailPx: 600,
        });
        members.wantsPinnedRef.current = false;
        members.bottomFollowModeStateRef.current = { dragSession: null, mode: 'released' };
        const hook = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: { ...buildDeps(members), isLoaded: true, platformOS: 'ios' } },
        );
        members.olderPagination.onScrollObservation.mockClear();

        hook.getCurrent().observeCommittedProjectionLayout();

        expect(members.olderPagination.onScrollObservation).toHaveBeenCalledWith({
            itemsToOlderEdge: 0,
            offsetY: 0,
            scrollable: true,
            trigger: 'layout-committed',
        });
        await hook.unmount();
    });

    it('calls wheel stopPropagation with the synthetic event as receiver', async () => {
        const members = createStableMembers();
        const hook = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: buildDeps(members) },
        );
        const host = hook.getCurrent();
        const event = {
            deltaY: 24,
            stopped: false,
            stopPropagation(this: { stopped: boolean }) {
                if (this !== event) throw new Error('detached stopPropagation call');
                this.stopped = true;
            },
        };

        const onWheel = host.platformInteractionProps.onWheel as ((nextEvent: unknown) => void) | undefined;
        expect(typeof onWheel).toBe('function');
        onWheel?.(event);

        expect(event.stopped).toBe(true);

        await hook.unmount();
    });

    it('routes web user takeover through the lifecycle owner to preempt the active explicit jump', async () => {
        const members = createStableMembers();
        members.dispatchViewportLifecycleEvent.mockImplementation((event) => ({
            effects: event.type === 'web-user-scroll-takeover'
                ? [
                    { sessionId: 's1', type: 'web-user-scroll-preempt-entry-restore' },
                    { sessionId: 's1', type: 'web-user-scroll-preempt-explicit-jump' },
                ]
                : [],
            state: members.lifecycleHost.getState(),
        }));
        const hook = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: buildDeps(members) },
        );

        const onWheel = hook.getCurrent().platformInteractionProps.onWheel as ((event: unknown) => void);
        onWheel({ deltaY: -24, stopPropagation: vi.fn() });

        expect(members.preemptEntryRestoreTransaction).toHaveBeenCalledTimes(1);
        expect(members.preemptExplicitJumpForUserTakeover).toHaveBeenCalledTimes(1);
        await hook.unmount();
    });

    it('keeps one explicitly interacted transcript as the keyboard owner after its focused row unmounts', async () => {
        const membersA = createStableMembers();
        const membersB = createStableMembers();
        const scrollerA = document.createElement('div');
        const scrollerB = document.createElement('div');
        const focusedRowA = document.createElement('button');
        const rowB = document.createElement('div');
        const outside = document.createElement('button');
        scrollerA.append(focusedRowA);
        scrollerB.append(rowB);
        document.body.append(scrollerA, scrollerB, outside);
        membersA.resolveWebScrollMetrics.mockReturnValue({
            clientHeight: 600,
            element: scrollerA,
            scrollHeight: 1200,
            scrollTop: 600,
        });
        membersB.resolveWebScrollMetrics.mockReturnValue({
            clientHeight: 600,
            element: scrollerB,
            scrollHeight: 1200,
            scrollTop: 600,
        });
        const notifyA = vi.fn();
        const notifyB = vi.fn();
        membersA.listRef.current = {
            notifyViewportInput: notifyA,
            scrollToIndex: vi.fn(),
            scrollToOffset: vi.fn(),
        };
        membersB.listRef.current = {
            notifyViewportInput: notifyB,
            scrollToIndex: vi.fn(),
            scrollToOffset: vi.fn(),
        };
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
        const hookA = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: { ...buildDeps(membersA), sessionId: 'session-a' } },
        );
        const hookB = await renderHook(
            (deps: ScrollObservationHostDeps) => useTranscriptScrollObservationHost(deps),
            { initialProps: { ...buildDeps(membersB), sessionId: 'session-b' } },
        );

        expect(hookA.getCurrent().platformInteractionProps.onKeyDown).toBeUndefined();
        expect(hookB.getCurrent().platformInteractionProps.onKeyDown).toBeUndefined();
        expect(
            addEventListenerSpy.mock.calls.filter(
                ([type, , options]) => type === 'keydown' && options === true,
            ),
        ).toHaveLength(1);

        focusedRowA.focus();
        expect(document.activeElement).toBe(focusedRowA);
        focusedRowA.remove();
        expect(document.activeElement).toBe(document.body);

        let activeElementObservedBeforeDefault: Element | null = null;
        document.body.addEventListener('keydown', () => {
            activeElementObservedBeforeDefault = document.activeElement;
        }, { once: true });
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'PageDown',
        }));

        expect(notifyA).toHaveBeenCalledTimes(1);
        expect(notifyA).toHaveBeenLastCalledWith({
            kind: 'keyboard',
            verticalDirection: 'toward-end',
        });
        expect(notifyB).not.toHaveBeenCalled();
        expect(activeElementObservedBeforeDefault).toBe(scrollerA);
        expect(scrollerA.getAttribute('tabindex')).toBe('-1');

        outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'PageDown',
        }));
        expect(notifyA).toHaveBeenCalledTimes(1);
        expect(notifyB).not.toHaveBeenCalled();

        rowB.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'PageDown',
        }));
        expect(notifyA).toHaveBeenCalledTimes(1);
        expect(notifyB).toHaveBeenCalledTimes(1);
        expect(notifyB).toHaveBeenLastCalledWith({
            kind: 'keyboard',
            verticalDirection: 'toward-end',
        });

        rowB.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'PageDown',
        }));
        expect(notifyA).toHaveBeenCalledTimes(1);
        expect(notifyB).toHaveBeenCalledTimes(2);
        document.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'PageDown',
        }));
        expect(notifyB).toHaveBeenCalledTimes(3);

        await hookA.unmount();
        await hookB.unmount();
        expect(scrollerA.hasAttribute('tabindex')).toBe(false);
        expect(scrollerB.hasAttribute('tabindex')).toBe(false);
        expect(
            removeEventListenerSpy.mock.calls.filter(
                ([type, , options]) => type === 'keydown' && options === true,
            ),
        ).toHaveLength(1);
    });
});
