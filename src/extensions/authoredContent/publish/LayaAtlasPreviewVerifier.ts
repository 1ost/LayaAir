import type { AuthoredImagePublishPlan } from "./AuthoredImagePublishPipeline";

export interface AuthoredImagePreviewTexture {
    width: number;
    height: number;
}

export interface AuthoredImagePreviewLoader {
    loadAtlas(url: string): Promise<unknown>;
    getTexture(uuidUrl: string): AuthoredImagePreviewTexture | null;
}

/** Structural subset implemented by Laya's normal Loader instance. */
export interface LayaAtlasLoader {
    load(url: string, options: { type: "atlas"; cache: true }): Promise<unknown>;
    getRes(url: string): unknown;
}

export interface AuthoredImagePreviewVerification {
    atlasCount: number;
    textureCount: number;
    verifiedUuids: readonly string[];
}

/**
 * Adapter for the normal native Laya atlas loader/cache path. The publish
 * pipeline does not register another loader and has no loose-image fallback.
 */
export function createLayaAtlasPreviewLoader(loader: LayaAtlasLoader): AuthoredImagePreviewLoader {
    return {
        // `atlas` is Loader.ATLAS. Keeping Loader type-only lets editor tooling
        // remain outside runtime bundles while still using the standard API.
        loadAtlas: (url: string) => loader.load(url, { type: "atlas", cache: true }),
        getTexture: (uuidUrl: string) => loader.getRes(uuidUrl) as AuthoredImagePreviewTexture | null,
    };
}

/** Verify every packed UUID after all standard .atlas manifests are loaded. */
export async function verifyAuthoredImageNativePreview(
    plan: AuthoredImagePublishPlan,
    preview: AuthoredImagePreviewLoader,
): Promise<AuthoredImagePreviewVerification> {
    if (!preview)
        throw new Error("Authored image preview: a native Laya loader is required");
    for (const atlas of plan.atlases) {
        const loaded = await preview.loadAtlas(atlas.manifestPath);
        if (!loaded)
            throw new Error(`Authored image preview: failed to load ${atlas.manifestPath}`);
    }
    const verified: string[] = [];
    for (const atlas of plan.atlases) {
        const placements = [] as Array<{ uuid: string; width: number; height: number }>;
        for (const page of atlas.pages)
            placements.push(...page.placements);
        placements.sort((left, right) => left.uuid.localeCompare(right.uuid));
        for (const source of placements) {
            const texture = preview.getTexture(`res://${source.uuid}`);
            if (!texture)
                throw new Error(`Authored image preview: missing res://${source.uuid}`);
            if (texture.width !== source.width || texture.height !== source.height) {
                throw new Error(
                    `Authored image preview: res://${source.uuid} is ${texture.width}x${texture.height}; expected ${source.width}x${source.height}`,
                );
            }
            verified.push(source.uuid);
        }
    }
    return {
        atlasCount: plan.atlases.length,
        textureCount: verified.length,
        verifiedUuids: verified.sort(),
    };
}
