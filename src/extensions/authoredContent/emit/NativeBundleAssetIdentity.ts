export interface NativeBundleResourcePath {
    readonly id: string;
    readonly outputPath: string;
}

export interface NativeBundleNestedTimelinePath {
    readonly semanticPath: string;
    readonly outputPath: string;
}

export interface NativeBundleAssetBindings {
    readonly timelineAssetId: string;
    readonly resourceAssetIds: ReadonlyMap<string, string>;
    readonly nestedTimelineAssetIds: ReadonlyMap<string, string>;
}

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Creates globally unique serialized UUIDs for one native authored bundle.
 * File output paths remain bundle-relative; only the identity written into the
 * hierarchy and resolved through AssetDb is namespaced.
 */
export function createNativeBundleAssetBindings(
    bundleId: string,
    timelineOutputPath: string,
    resources: ReadonlyArray<NativeBundleResourcePath>,
    nestedTimelines: ReadonlyArray<NativeBundleNestedTimelinePath>,
): NativeBundleAssetBindings {
    if (typeof bundleId !== "string" || !BUNDLE_ID.test(bundleId))
        throw new Error("AUTHORED_CONTENT_NATIVE_BUNDLE_ID_INVALID");
    const claimedIds = new Set<string>();
    const qualify = (outputPath: string): string => {
        const normalized = canonicalRelativePath(outputPath);
        const assetId = `${bundleId}/${normalized}`;
        if (claimedIds.has(assetId))
            throw new Error(`AUTHORED_CONTENT_NATIVE_BUNDLE_ASSET_ID_COLLISION: ${assetId}`);
        claimedIds.add(assetId);
        return assetId;
    };
    const timelineAssetId = qualify(timelineOutputPath);
    const resourceAssetIds = new Map<string, string>();
    for (const resource of resources) {
        if (!resource || typeof resource !== "object" || typeof resource.id !== "string" || resource.id.length === 0
            || resourceAssetIds.has(resource.id))
            throw new Error("AUTHORED_CONTENT_NATIVE_BUNDLE_RESOURCE_ID_INVALID");
        resourceAssetIds.set(resource.id, qualify(resource.outputPath));
    }
    const nestedTimelineAssetIds = new Map<string, string>();
    for (const nested of nestedTimelines) {
        if (!nested || typeof nested !== "object" || typeof nested.semanticPath !== "string"
            || nested.semanticPath.length === 0 || nestedTimelineAssetIds.has(nested.semanticPath))
            throw new Error("AUTHORED_CONTENT_NATIVE_BUNDLE_SEMANTIC_PATH_INVALID");
        nestedTimelineAssetIds.set(nested.semanticPath, qualify(nested.outputPath));
    }
    return { timelineAssetId, resourceAssetIds, nestedTimelineAssetIds };
}

function canonicalRelativePath(value: string): string {
    if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/"))
        throw new Error("AUTHORED_CONTENT_NATIVE_BUNDLE_PATH_INVALID");
    const segments = value.split("/");
    if (segments.some(segment => segment.length === 0 || segment === "." || segment === ".."))
        throw new Error("AUTHORED_CONTENT_NATIVE_BUNDLE_PATH_INVALID");
    return segments.join("/");
}
