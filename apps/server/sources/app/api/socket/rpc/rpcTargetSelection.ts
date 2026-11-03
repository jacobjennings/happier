import type { RpcAckResponseEmitter, RpcTargetSelectionResult } from "./_types";
import { SocketRpcAnsweringClientCandidateV1Schema, type SocketRpcAnsweringClientV1 } from '@happier-dev/protocol/socketRpc';

export function selectRpcTarget(params: Readonly<{
    targets: RpcAckResponseEmitter[];
    excludedSocketId?: string;
    answeringClient?: SocketRpcAnsweringClientV1;
}>): RpcTargetSelectionResult {
    const distinctTargets = [...params.targets].sort((left, right) => left.id.localeCompare(right.id));
    const nonCallerTargets =
        typeof params.excludedSocketId === "string" && params.excludedSocketId.length > 0
            ? distinctTargets.filter((target) => target.id !== params.excludedSocketId)
            : distinctTargets;
    const eligibleTargets = params.answeringClient?.clientId === undefined ? nonCallerTargets
        : nonCallerTargets.filter(target => target.id === params.answeringClient!.clientId);

    if (eligibleTargets.length === 0) {
        const callerWasPresent = typeof params.excludedSocketId === "string"
            && distinctTargets.some((target) => target.id === params.excludedSocketId);
        return callerWasPresent && !params.answeringClient?.clientId ? { type: "self-call" } : { type: "not-available" };
    }

    if (params.answeringClient?.requireSingle && eligibleTargets.length > 1) {
        // This fact is stamped only by the existing authenticated ui-focus push.
        // Missing history or equal timestamps cannot choose a person’s client.
        const focused = eligibleTargets.filter(target => typeof target.data?.uiLastFocusedAt === 'number'
            && Number.isFinite(target.data.uiLastFocusedAt));
        const latestAt = focused.reduce((latest, target) => Math.max(latest, target.data!.uiLastFocusedAt as number), -Infinity);
        const latest = focused.filter(target => target.data!.uiLastFocusedAt === latestAt);
        if (latest.length === 1) return { type: 'target', target: latest[0], hadMultipleTargets: true,
            clientIds: nonCallerTargets.map(target => target.id) };
        return { type: 'ambiguous', clientIds: eligibleTargets.map(target => target.id), clients: eligibleTargets.map(target => {
            const focus = target.data?.uiFocus;
            const state = focus && typeof focus === 'object' ? focus as Record<string, unknown> : {};
            return SocketRpcAnsweringClientCandidateV1Schema.parse({ id: target.id, deviceLabel: null,
                ...(typeof state.computer === 'boolean' && typeof state.focused === 'boolean' ? { state: {
                    computer: state.computer, focused: state.focused,
                    ...(typeof target.data?.uiLastFocusedAt === 'number' && Number.isFinite(target.data.uiLastFocusedAt)
                        ? { lastFocusedAt: target.data.uiLastFocusedAt } : {}),
                } } : {}),
            });
        }) };
    }

    return {
        type: "target",
        target: eligibleTargets[0],
        hadMultipleTargets: !params.answeringClient?.clientId && (eligibleTargets.length > 1 || distinctTargets.length > 1),
        ...(params.answeringClient ? { clientIds: nonCallerTargets.map(target => target.id) } : {}),
    };
}
