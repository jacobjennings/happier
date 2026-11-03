import * as React from 'react';

export type UiSurfaceRendererKind = 'declarative' | 'reactNative' | 'hostedWeb' | 'hostedHtml';

export function isUiSurfaceRendererKind(value: unknown): value is UiSurfaceRendererKind {
    return value === 'declarative'
        || value === 'reactNative'
        || value === 'hostedWeb'
        || value === 'hostedHtml';
}

export type UiSurfaceRendererFactories<TResult> = Readonly<{
    declarative: () => TResult;
    reactNative: () => TResult;
    hostedWeb: () => TResult;
    hostedHtml: () => TResult;
}>;

/**
 * The one physical renderer dispatch. Domain adapters retain authority and
 * prepare admitted factories; this kernel knows only the closed renderer mode
 * and owns no plugin, Session, Board, placement, or capability decision.
 */
export function UiSurfaceRendererHost(props: Readonly<{
    kind: UiSurfaceRendererKind;
    renderers: UiSurfaceRendererFactories<React.ReactNode>;
}>): React.ReactNode {
    return props.renderers[props.kind]();
}
