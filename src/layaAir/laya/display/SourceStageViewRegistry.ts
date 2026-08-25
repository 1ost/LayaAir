type SourceStageViewResolver = (value: object) => object | null;

let resolver: SourceStageViewResolver | null = null;

/** @internal Installs the canonical source Stage lookup exactly once. */
export function registerSourceStageViewResolver(value: SourceStageViewResolver): void {
    if (resolver !== null && resolver !== value)
        throw new Error("Source Stage view resolver is already registered");
    resolver = value;
}

/** @internal Resolves only through the registered source Stage facade factory. */
export function sourceStageViewForDisplayObject(value: object): object | null {
    return resolver?.(value) ?? null;
}
