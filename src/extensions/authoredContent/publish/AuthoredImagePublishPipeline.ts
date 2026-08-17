/**
 * Deterministic publish planning for loose, UUID-addressed authored images.
 *
 * This module deliberately does not decode or encode pixels. The LayaAir IDE
 * publish host owns that native image seam and must provide an
 * AuthoredImagePublishWriter. Runtime code consumes only the emitted standard
 * Laya atlas files and explicit localized-media map.
 */

export const AUTHORED_IMAGE_PUBLISH_SCHEMA = "laya-authored-image-publish@1";
export const LOCALIZED_MEDIA_MAP_SCHEMA = "laya-localized-media-map@1";

export type AuthoredImageLifecycle = "bootstrap" | "session" | "scene" | "transient";
export type AuthoredImageFilter = "nearest" | "linear";
export type AuthoredImageAlpha = "opaque" | "straight" | "premultiplied";
export type AuthoredImageColorSpace = "srgb" | "linear";
export type AuthoredImageCompression = "png" | "ktx1";
export type AuthoredImageRepeat = "clamp" | "repeat-x" | "repeat-y" | "repeat";

export interface AuthoredImageSampler {
    filter: AuthoredImageFilter;
    mipmaps: boolean;
}

export type AuthoredImageOwnership =
    | { kind: "common" }
    | { kind: "locale"; locale: string };

export interface AuthoredImageSource {
    /** Stable AssetDb UUID. Paths are authoring details and may change. */
    uuid: string;
    /** Stable application-neutral semantic key used by the locale map. */
    mediaKey: string;
    /** Loose authoring path. Published atlas paths must never be supplied here. */
    sourcePath: string;
    sourceSha256: string;
    width: number;
    height: number;
    lifecycle: AuthoredImageLifecycle;
    ownership: AuthoredImageOwnership;
    sampler: AuthoredImageSampler;
    alpha: AuthoredImageAlpha;
    colorSpace: AuthoredImageColorSpace;
    compression: AuthoredImageCompression;
    repeat: AuthoredImageRepeat;
}

export interface LocalizedMediaDeclaration {
    mediaKey: string;
    common?: string;
    locales?: Readonly<Record<string, string>>;
}

export interface AuthoredImagePublishOptions {
    maxAtlasSize: number;
    padding: number;
}

export interface AuthoredImagePlacement {
    uuid: string;
    sourcePath: string;
    x: number;
    y: number;
    width: number;
    height: number;
    padding: number;
}

export interface AuthoredImageAtlasPage {
    index: number;
    outputPath: string;
    width: number;
    height: number;
    compression: AuthoredImageCompression;
    placements: readonly AuthoredImagePlacement[];
}

export interface AuthoredImageAtlas {
    groupKey: string;
    ownership: AuthoredImageOwnership;
    lifecycle: AuthoredImageLifecycle;
    sampler: AuthoredImageSampler;
    alpha: AuthoredImageAlpha;
    colorSpace: AuthoredImageColorSpace;
    compression: AuthoredImageCompression;
    repeat: "clamp";
    manifestPath: string;
    pages: readonly AuthoredImageAtlasPage[];
    manifest: LayaAtlasManifest;
}

export interface LoosePublishedImage {
    uuid: string;
    sourcePath: string;
    outputPath: string;
    reason: "repeat-policy" | "oversized";
    ownership: AuthoredImageOwnership;
    lifecycle: AuthoredImageLifecycle;
    sampler: AuthoredImageSampler;
    alpha: AuthoredImageAlpha;
    colorSpace: AuthoredImageColorSpace;
    compression: AuthoredImageCompression;
    repeat: AuthoredImageRepeat;
}

export interface LocalizedMediaMapEntry {
    common?: string;
    locales: Readonly<Record<string, string>>;
}

export interface LocalizedMediaMap {
    schema: typeof LOCALIZED_MEDIA_MAP_SCHEMA;
    entries: Readonly<Record<string, LocalizedMediaMapEntry>>;
}

export interface LayaAtlasFrame {
    frame: { x: number; y: number; w: number; h: number; idx: number };
    spriteSourceSize: { x: number; y: number };
    sourceSize: { w: number; h: number };
    filename: string;
}

export interface LayaAtlasManifest {
    frames: Readonly<Record<string, LayaAtlasFrame>>;
    meta: {
        image: string;
        prefix: "res://";
        scale: 1;
    };
}

export interface AuthoredImagePublishPlan {
    schema: typeof AUTHORED_IMAGE_PUBLISH_SCHEMA;
    options: Readonly<AuthoredImagePublishOptions>;
    sources: readonly AuthoredImageSource[];
    atlases: readonly AuthoredImageAtlas[];
    looseImages: readonly LoosePublishedImage[];
    localizedMediaMapPath: "media/localized-media-map.json";
    localizedMediaMap: LocalizedMediaMap;
    outputFiles: readonly string[];
}

export interface AuthoredImageAtlasPageWriteResult {
    outputPath: string;
    width: number;
    height: number;
    sha256: string;
}

export interface AuthoredImageLooseWriteResult {
    outputPath: string;
    sha256: string;
}

/** Required IDE/native publish seam. There is intentionally no default writer. */
export interface AuthoredImagePublishWriter {
    writeAtlasPage(page: AuthoredImageAtlasPage, sources: readonly AuthoredImageSource[]): Promise<AuthoredImageAtlasPageWriteResult>;
    writeLooseImage(image: LoosePublishedImage, source: AuthoredImageSource): Promise<AuthoredImageLooseWriteResult>;
    writeTextFile(outputPath: string, contents: string): Promise<void>;
}

export interface AuthoredImagePublishedFile {
    path: string;
    kind: "atlas-image" | "atlas-manifest" | "loose-image" | "localized-media-map";
    sha256?: string;
}

export interface AuthoredImagePublishReceipt {
    schema: typeof AUTHORED_IMAGE_PUBLISH_SCHEMA;
    files: readonly AuthoredImagePublishedFile[];
}

interface MutableShelf {
    y: number;
    height: number;
    x: number;
}

interface MutablePage {
    placements: AuthoredImagePlacement[];
    shelves: MutableShelf[];
    usedWidth: number;
    usedHeight: number;
}

const UUID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{7,127}$/;
const MEDIA_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const LIFECYCLES = new Set<AuthoredImageLifecycle>(["bootstrap", "session", "scene", "transient"]);
const FILTERS = new Set<AuthoredImageFilter>(["nearest", "linear"]);
const ALPHAS = new Set<AuthoredImageAlpha>(["opaque", "straight", "premultiplied"]);
const COLOR_SPACES = new Set<AuthoredImageColorSpace>(["srgb", "linear"]);
const COMPRESSIONS = new Set<AuthoredImageCompression>(["png", "ktx1"]);
const REPEATS = new Set<AuthoredImageRepeat>(["clamp", "repeat-x", "repeat-y", "repeat"]);

function fail(message: string): never {
    throw new Error(`Authored image publish: ${message}`);
}

function deepFreeze<T>(value: T, seen: Set<object> = new Set<object>()): T {
    if (value === null || typeof value !== "object" || seen.has(value as object))
        return value;
    seen.add(value as object);
    for (const child of Object.values(value as Record<string, unknown>))
        deepFreeze(child, seen);
    return Object.freeze(value);
}

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0)
        fail(`${label} must be a positive safe integer`);
}

function normalizePath(value: string, label: string): string {
    if (typeof value !== "string" || value.length === 0)
        fail(`${label} must be a non-empty string`);
    if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value))
        fail(`${label} must be a normalized relative POSIX path`);
    const parts = value.split("/");
    if (parts.some(part => part === "" || part === "." || part === ".."))
        fail(`${label} must be a normalized relative POSIX path`);
    return parts.join("/");
}

function normalizeLocale(value: string): string {
    if (!LOCALE_PATTERN.test(value))
        fail(`invalid locale ${JSON.stringify(value)}`);
    return value.split("-").map((part, index) => {
        if (index === 0)
            return part.toLowerCase();
        if (part.length === 2 && /^[A-Za-z]+$/.test(part))
            return part.toUpperCase();
        return part.toLowerCase();
    }).join("-");
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalOwnership(value: AuthoredImageOwnership, label: string): AuthoredImageOwnership {
    if (!value || typeof value !== "object")
        fail(`${label}.ownership must be explicit`);
    if (value.kind === "common")
        return { kind: "common" };
    if (value.kind === "locale")
        return { kind: "locale", locale: normalizeLocale(value.locale) };
    fail(`${label}.ownership.kind is invalid`);
}

function canonicalSource(source: AuthoredImageSource, index: number): AuthoredImageSource {
    const label = `sources[${index}]`;
    if (!UUID_PATTERN.test(source.uuid))
        fail(`${label}.uuid is not a stable UUID token`);
    if (!MEDIA_KEY_PATTERN.test(source.mediaKey) || source.mediaKey.includes(".."))
        fail(`${label}.mediaKey is invalid`);
    const sourcePath = normalizePath(source.sourcePath, `${label}.sourcePath`);
    if (/\/(?:atlases?|published?)\//i.test(`/${sourcePath}/`))
        fail(`${label}.sourcePath must remain a loose authoring file`);
    if (!SHA256_PATTERN.test(source.sourceSha256))
        fail(`${label}.sourceSha256 must be lowercase SHA-256`);
    assertPositiveInteger(source.width, `${label}.width`);
    assertPositiveInteger(source.height, `${label}.height`);
    if (!LIFECYCLES.has(source.lifecycle)) fail(`${label}.lifecycle is invalid`);
    if (!source.sampler || !FILTERS.has(source.sampler.filter) || typeof source.sampler.mipmaps !== "boolean")
        fail(`${label}.sampler is invalid`);
    if (!ALPHAS.has(source.alpha)) fail(`${label}.alpha is invalid`);
    if (!COLOR_SPACES.has(source.colorSpace)) fail(`${label}.colorSpace is invalid`);
    if (!COMPRESSIONS.has(source.compression)) fail(`${label}.compression is invalid`);
    if (!REPEATS.has(source.repeat)) fail(`${label}.repeat is invalid`);
    return {
        uuid: source.uuid,
        mediaKey: source.mediaKey,
        sourcePath,
        sourceSha256: source.sourceSha256,
        width: source.width,
        height: source.height,
        lifecycle: source.lifecycle,
        ownership: canonicalOwnership(source.ownership, label),
        sampler: {
            filter: source.sampler.filter,
            mipmaps: source.sampler.mipmaps,
        },
        alpha: source.alpha,
        colorSpace: source.colorSpace,
        compression: source.compression,
        repeat: source.repeat,
    };
}

function sourceOrder(left: AuthoredImageSource, right: AuthoredImageSource): number {
    return compareText(left.uuid, right.uuid) || compareText(left.sourcePath, right.sourcePath);
}

function ownershipKey(ownership: AuthoredImageOwnership): string {
    return ownership.kind === "common" ? "common" : `locale:${ownership.locale}`;
}

function groupKey(source: AuthoredImageSource): string {
    return [
        ownershipKey(source.ownership),
        source.lifecycle,
        source.sampler.filter,
        source.sampler.mipmaps ? "mip" : "nomip",
        source.alpha,
        source.colorSpace,
        source.compression,
        source.repeat,
    ].join("|");
}

function groupSlug(source: AuthoredImageSource): string {
    return [
        source.lifecycle,
        source.sampler.filter,
        source.sampler.mipmaps ? "mip" : "nomip",
        source.alpha,
        source.colorSpace,
        source.compression,
        source.repeat,
    ].join("-");
}

function outputRoot(ownership: AuthoredImageOwnership, root: "atlases" | "media"): string {
    return ownership.kind === "common"
        ? `${root}/common`
        : `${root}/locales/${ownership.locale}`;
}

function effectivePadding(source: AuthoredImageSource, configured: number): number {
    if (source.sampler.mipmaps)
        return Math.max(configured, 2);
    if (source.sampler.filter === "linear")
        return Math.max(configured, 1);
    return configured;
}

function nextPowerOfTwo(value: number): number {
    let result = 1;
    while (result < value)
        result *= 2;
    return result;
}

function tryPlace(page: MutablePage, source: AuthoredImageSource, padding: number, maxSize: number): AuthoredImagePlacement | null {
    const packedWidth = source.width + padding * 2;
    const packedHeight = source.height + padding * 2;
    for (const shelf of page.shelves) {
        if (packedHeight <= shelf.height && shelf.x + packedWidth <= maxSize) {
            const placement = {
                uuid: source.uuid,
                sourcePath: source.sourcePath,
                x: shelf.x + padding,
                y: shelf.y + padding,
                width: source.width,
                height: source.height,
                padding,
            };
            shelf.x += packedWidth;
            page.usedWidth = Math.max(page.usedWidth, shelf.x);
            return placement;
        }
    }
    const shelfY = page.shelves.length === 0
        ? 0
        : page.shelves[page.shelves.length - 1].y + page.shelves[page.shelves.length - 1].height;
    if (shelfY + packedHeight > maxSize)
        return null;
    const shelf: MutableShelf = { y: shelfY, height: packedHeight, x: packedWidth };
    page.shelves.push(shelf);
    page.usedWidth = Math.max(page.usedWidth, packedWidth);
    page.usedHeight = shelfY + packedHeight;
    return {
        uuid: source.uuid,
        sourcePath: source.sourcePath,
        x: padding,
        y: shelfY + padding,
        width: source.width,
        height: source.height,
        padding,
    };
}

function createAtlas(groupSources: readonly AuthoredImageSource[], options: Readonly<AuthoredImagePublishOptions>): AuthoredImageAtlas {
    const representative = groupSources[0];
    const sorted = [...groupSources].sort((left, right) =>
        right.height - left.height || right.width - left.width || sourceOrder(left, right));
    const pages: MutablePage[] = [];
    for (const source of sorted) {
        const padding = effectivePadding(source, options.padding);
        let placement: AuthoredImagePlacement | null = null;
        let page: MutablePage | undefined;
        for (const candidate of pages) {
            placement = tryPlace(candidate, source, padding, options.maxAtlasSize);
            if (placement) {
                page = candidate;
                break;
            }
        }
        if (!placement) {
            page = { placements: [], shelves: [], usedWidth: 0, usedHeight: 0 };
            placement = tryPlace(page, source, padding, options.maxAtlasSize);
            if (!placement)
                fail(`internal oversized image classification failed for ${source.uuid}`);
            pages.push(page);
        }
        page!.placements.push(placement);
    }

    const root = outputRoot(representative.ownership, "atlases");
    const slug = groupSlug(representative);
    const extension = representative.compression === "png" ? "png" : "ktx";
    const atlasPages: AuthoredImageAtlasPage[] = pages.map((page, index) => ({
        index,
        outputPath: `${root}/${slug}-p${String(index).padStart(3, "0")}.${extension}`,
        width: Math.min(options.maxAtlasSize, nextPowerOfTwo(page.usedWidth)),
        height: Math.min(options.maxAtlasSize, nextPowerOfTwo(page.usedHeight)),
        compression: representative.compression,
        placements: [...page.placements].sort((left, right) => compareText(left.uuid, right.uuid)),
    }));
    const frames: Record<string, LayaAtlasFrame> = {};
    for (const page of atlasPages) {
        for (const placement of page.placements) {
            frames[placement.uuid] = {
                frame: { x: placement.x, y: placement.y, w: placement.width, h: placement.height, idx: page.index },
                spriteSourceSize: { x: 0, y: 0 },
                sourceSize: { w: placement.width, h: placement.height },
                filename: placement.uuid,
            };
        }
    }
    return {
        groupKey: groupKey(representative),
        ownership: representative.ownership,
        lifecycle: representative.lifecycle,
        sampler: representative.sampler,
        alpha: representative.alpha,
        colorSpace: representative.colorSpace,
        compression: representative.compression,
        repeat: "clamp",
        manifestPath: `${root}/${slug}.atlas`,
        pages: atlasPages,
        manifest: {
            frames,
            meta: {
                image: atlasPages.map(page => page.outputPath.substring(page.outputPath.lastIndexOf("/") + 1)).join(","),
                prefix: "res://",
                scale: 1,
            },
        },
    };
}

function buildLocalizedMediaMap(sources: readonly AuthoredImageSource[], declarations: readonly LocalizedMediaDeclaration[]): LocalizedMediaMap {
    const byUuid = new Map(sources.map(source => [source.uuid, source]));
    const declaredUuids = new Set<string>();
    const entries: Record<string, LocalizedMediaMapEntry> = {};
    for (const declaration of [...declarations].sort((left, right) => compareText(left.mediaKey, right.mediaKey))) {
        if (!MEDIA_KEY_PATTERN.test(declaration.mediaKey) || declaration.mediaKey.includes(".."))
            fail(`invalid localized media key ${JSON.stringify(declaration.mediaKey)}`);
        if (entries[declaration.mediaKey])
            fail(`duplicate localized media declaration ${declaration.mediaKey}`);
        const locales: Record<string, string> = {};
        if (declaration.common) {
            const source = byUuid.get(declaration.common);
            if (!source || source.mediaKey !== declaration.mediaKey || source.ownership.kind !== "common")
                fail(`${declaration.mediaKey}.common does not name its common source`);
            if (declaredUuids.has(source.uuid)) fail(`source ${source.uuid} is declared twice`);
            declaredUuids.add(source.uuid);
        }
        for (const [rawLocale, uuid] of Object.entries(declaration.locales || {}).sort(([left], [right]) => compareText(left, right))) {
            const locale = normalizeLocale(rawLocale);
            if (locales[locale]) fail(`${declaration.mediaKey} declares locale ${locale} twice`);
            const source = byUuid.get(uuid);
            if (!source || source.mediaKey !== declaration.mediaKey || source.ownership.kind !== "locale" || source.ownership.locale !== locale)
                fail(`${declaration.mediaKey}.${locale} does not name its locale-owned source`);
            if (declaredUuids.has(source.uuid)) fail(`source ${source.uuid} is declared twice`);
            declaredUuids.add(source.uuid);
            locales[locale] = uuid;
        }
        if (!declaration.common && Object.keys(locales).length === 0)
            fail(`${declaration.mediaKey} is empty`);
        entries[declaration.mediaKey] = {
            ...(declaration.common ? { common: declaration.common } : {}),
            locales,
        };
    }
    for (const source of sources) {
        if (!declaredUuids.has(source.uuid))
            fail(`source ${source.uuid} is absent from the explicit localized media map`);
    }
    return { schema: LOCALIZED_MEDIA_MAP_SCHEMA, entries };
}

export function createAuthoredImagePublishPlan(
    rawSources: readonly AuthoredImageSource[],
    localizedMedia: readonly LocalizedMediaDeclaration[],
    rawOptions: Readonly<AuthoredImagePublishOptions>,
): AuthoredImagePublishPlan {
    assertPositiveInteger(rawOptions.maxAtlasSize, "options.maxAtlasSize");
    if (!Number.isSafeInteger(rawOptions.padding) || rawOptions.padding < 0)
        fail("options.padding must be a non-negative safe integer");
    const options = { maxAtlasSize: rawOptions.maxAtlasSize, padding: rawOptions.padding };
    const sources = rawSources.map(canonicalSource).sort(sourceOrder);
    if (sources.length === 0)
        fail("at least one source is required");
    const uuids = new Set<string>();
    const paths = new Set<string>();
    const scopedKeys = new Set<string>();
    for (const source of sources) {
        if (uuids.has(source.uuid)) fail(`duplicate UUID ${source.uuid}`);
        if (paths.has(source.sourcePath)) fail(`duplicate source path ${source.sourcePath}`);
        const scopedKey = `${source.mediaKey}|${ownershipKey(source.ownership)}`;
        if (scopedKeys.has(scopedKey)) fail(`duplicate media ownership ${scopedKey}`);
        uuids.add(source.uuid);
        paths.add(source.sourcePath);
        scopedKeys.add(scopedKey);
    }
    const localizedMediaMap = buildLocalizedMediaMap(sources, localizedMedia);
    const looseImages: LoosePublishedImage[] = [];
    const grouped = new Map<string, AuthoredImageSource[]>();
    for (const source of sources) {
        const padding = effectivePadding(source, options.padding);
        const oversized = source.width + padding * 2 > options.maxAtlasSize
            || source.height + padding * 2 > options.maxAtlasSize;
        if (source.repeat !== "clamp" || oversized) {
            const extension = source.compression === "png" ? "png" : "ktx";
            looseImages.push({
                uuid: source.uuid,
                sourcePath: source.sourcePath,
                outputPath: `${outputRoot(source.ownership, "media")}/${source.uuid}.${extension}`,
                reason: source.repeat !== "clamp" ? "repeat-policy" : "oversized",
                ownership: source.ownership,
                lifecycle: source.lifecycle,
                sampler: source.sampler,
                alpha: source.alpha,
                colorSpace: source.colorSpace,
                compression: source.compression,
                repeat: source.repeat,
            });
            continue;
        }
        const key = groupKey(source);
        const group = grouped.get(key) || [];
        group.push(source);
        grouped.set(key, group);
    }
    const atlases = [...grouped.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([, group]) => createAtlas(group, options));
    looseImages.sort((left, right) => compareText(left.outputPath, right.outputPath));
    const outputFiles: string[] = [];
    for (const atlas of atlases) {
        outputFiles.push(atlas.manifestPath);
        for (const page of atlas.pages)
            outputFiles.push(page.outputPath);
    }
    for (const image of looseImages)
        outputFiles.push(image.outputPath);
    outputFiles.push("media/localized-media-map.json");
    outputFiles.sort(compareText);
    if (new Set(outputFiles).size !== outputFiles.length)
        fail("publish output paths collide");
    return deepFreeze({
        schema: AUTHORED_IMAGE_PUBLISH_SCHEMA,
        options,
        sources,
        atlases,
        looseImages,
        localizedMediaMapPath: "media/localized-media-map.json",
        localizedMediaMap,
        outputFiles,
    });
}

function stableJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function findSource(plan: AuthoredImagePublishPlan, uuid: string): AuthoredImageSource {
    const source = plan.sources.find(candidate => candidate.uuid === uuid);
    if (!source) fail(`plan references unknown source ${uuid}`);
    return source;
}

function immutableSourceSnapshot(source: AuthoredImageSource): AuthoredImageSource {
    return deepFreeze({
        ...source,
        ownership: { ...source.ownership },
        sampler: { ...source.sampler },
    });
}

function immutablePageSnapshot(page: AuthoredImageAtlasPage): AuthoredImageAtlasPage {
    return deepFreeze({
        ...page,
        placements: page.placements.map(placement => ({ ...placement })),
    });
}

function immutableLooseSnapshot(image: LoosePublishedImage): LoosePublishedImage {
    return deepFreeze({
        ...image,
        ownership: { ...image.ownership },
        sampler: { ...image.sampler },
    });
}

export async function publishAuthoredImages(
    plan: AuthoredImagePublishPlan,
    writer: AuthoredImagePublishWriter,
): Promise<AuthoredImagePublishReceipt> {
    if (!writer)
        fail("an IDE/native publish writer is required; runtime fallback is forbidden");
    const files: AuthoredImagePublishedFile[] = [];
    for (const atlas of plan.atlases) {
        for (const page of atlas.pages) {
            const expectedPath = page.outputPath;
            const expectedWidth = page.width;
            const expectedHeight = page.height;
            const pageSnapshot = immutablePageSnapshot(page);
            const sourceSnapshots = deepFreeze(page.placements.map(placement =>
                immutableSourceSnapshot(findSource(plan, placement.uuid))));
            const frozenAuthority = stableJson({ page: pageSnapshot, sources: sourceSnapshots });
            const result = await writer.writeAtlasPage(pageSnapshot, sourceSnapshots);
            if (stableJson({ page: pageSnapshot, sources: sourceSnapshots }) !== frozenAuthority)
                fail(`writer mutated immutable page authority for ${expectedPath}`);
            if (result.outputPath !== expectedPath || result.width !== expectedWidth || result.height !== expectedHeight)
                fail(`writer changed the deterministic page contract for ${expectedPath}`);
            if (!SHA256_PATTERN.test(result.sha256))
                fail(`writer returned an invalid digest for ${expectedPath}`);
            files.push({ path: expectedPath, kind: "atlas-image", sha256: result.sha256 });
        }
        await writer.writeTextFile(atlas.manifestPath, stableJson(atlas.manifest));
        files.push({ path: atlas.manifestPath, kind: "atlas-manifest" });
    }
    for (const image of plan.looseImages) {
        const expectedPath = image.outputPath;
        const expectedUuid = image.uuid;
        const imageSnapshot = immutableLooseSnapshot(image);
        const sourceSnapshot = immutableSourceSnapshot(findSource(plan, image.uuid));
        const frozenAuthority = stableJson({ image: imageSnapshot, source: sourceSnapshot });
        const result = await writer.writeLooseImage(imageSnapshot, sourceSnapshot);
        if (stableJson({ image: imageSnapshot, source: sourceSnapshot }) !== frozenAuthority)
            fail(`writer mutated immutable loose authority for ${expectedUuid}`);
        if (result.outputPath !== expectedPath)
            fail(`writer changed the deterministic loose path for ${expectedUuid}`);
        if (!SHA256_PATTERN.test(result.sha256))
            fail(`writer returned an invalid digest for ${expectedPath}`);
        files.push({ path: expectedPath, kind: "loose-image", sha256: result.sha256 });
    }
    await writer.writeTextFile(plan.localizedMediaMapPath, stableJson(plan.localizedMediaMap));
    files.push({ path: plan.localizedMediaMapPath, kind: "localized-media-map" });
    files.sort((left, right) => compareText(left.path, right.path));
    const actualPaths = files.map(file => file.path);
    if (JSON.stringify(actualPaths) !== JSON.stringify(plan.outputFiles))
        fail("writer receipt does not match the planned file inventory");
    return { schema: AUTHORED_IMAGE_PUBLISH_SCHEMA, files };
}
