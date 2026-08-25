type SourceStageViewResolver = (value: object) => object | null;
type SourceDisplayObjectContainerResolver = (value: object) => object | null;

let resolver: SourceStageViewResolver | null = null;
let nativeStageResolver: SourceStageViewResolver | null = null;
let displayObjectContainerResolver: SourceDisplayObjectContainerResolver | null = null;

/** @internal Installs the canonical source Stage lookup exactly once. */
export function registerSourceStageViewResolver(
    value: SourceStageViewResolver,
    nativeValue: SourceStageViewResolver,
): void {
    if (resolver !== null && resolver !== value)
        throw new Error("Source Stage view resolver is already registered");
    if (nativeStageResolver !== null && nativeStageResolver !== nativeValue)
        throw new Error("Native Stage view resolver is already registered");
    resolver = value;
    nativeStageResolver = nativeValue;
}

/** @internal Resolves only through the registered source Stage facade factory. */
export function sourceStageViewForDisplayObject(value: object): object | null {
    return resolver?.(value) ?? null;
}

/** @internal Resolves only an exact native Stage parent to its stable source view. */
export function sourceStageViewForNativeParent(value: object): object | null {
    return nativeStageResolver?.(value) ?? null;
}

/** @internal Installs canonical Flash container authentication exactly once. */
export function registerSourceDisplayObjectContainerResolver(
    value: SourceDisplayObjectContainerResolver,
): void {
    if (displayObjectContainerResolver !== null && displayObjectContainerResolver !== value)
        throw new Error("Source DisplayObjectContainer resolver is already registered");
    displayObjectContainerResolver = value;
}

/** @internal Projects only a nominal Flash container parent to source identity. */
export function sourceDisplayObjectContainerForNativeParent(value: object): object | null {
    return displayObjectContainerResolver?.(value) ?? null;
}
