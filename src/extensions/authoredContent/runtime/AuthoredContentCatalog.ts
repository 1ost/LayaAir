import { Node } from "../../../layaAir/laya/display/Node";
import { Loader } from "../../../layaAir/laya/net/Loader";
import { URL } from "../../../layaAir/laya/net/URL";
import { AssetDb } from "../../../layaAir/laya/resource/AssetDb";
import { TextResource, TextResourceFormat } from "../../../layaAir/laya/resource/TextResource";
import type { Prefab } from "../../../layaAir/laya/resource/HierarchyResource";
import {
    loadAndActivateAuthoredFontCatalog,
    type AuthoredFontCatalogActivation,
    type AuthoredFontCatalogLoadOptions,
    type AuthoredFontCatalogResponse,
} from "./AuthoredFontCatalog";
import { DisplayObject, MovieClip, SimpleButton, Sprite, TextField } from "../../../layaAir/flash";
import { applyAuthoredLocaleText } from "./AuthoredTextField";
import { ApplicationDomain } from "../../../layaAir/flash/system/ApplicationDomain";
import {
    createAuthoredPrefabDefinition,
    registerAuthoredContentRuntime,
    type AuthoredPrefabDefinition,
    type AuthoredRuntimeLinkage,
    type AuthoredSourceType,
} from "./bootstrap";

export const AUTHORED_CONTENT_CATALOG_SCHEMA = "laya-authored-content-catalog@1" as const;
export const AUTHORED_CONTENT_LOCALE_SCHEMA = "laya-authored-content-locale@1" as const;
export const AUTHORED_CONTENT_CATALOG_SUFFIX = ".runtime-catalog.json" as const;
export const AUTHORED_CONTENT_BASE_LOCALE = "en_Eu" as const;

export type AuthoredCatalogAssetKind = "image" | "timeline";

export interface AuthoredCatalogAsset {
    readonly id: string;
    readonly path: string;
    readonly kind: AuthoredCatalogAssetKind;
}

export interface AuthoredCatalogBundle {
    readonly id: string;
    readonly runtimeId: string;
    readonly linkage: string;
    readonly sourceType: AuthoredSourceType;
    readonly prefab: string;
    /** Authenticated embedded fonts which must be active before prefab construction. */
    readonly fontStartup?: string;
    readonly assets: readonly AuthoredCatalogAsset[];
}

export interface AuthoredContentCatalogManifest {
    readonly schema: typeof AUTHORED_CONTENT_CATALOG_SCHEMA;
    readonly id: string;
    readonly bundles: readonly AuthoredCatalogBundle[];
}

export interface AuthoredCatalogAssetOverride {
    readonly id: string;
    readonly path: string;
}

export interface AuthoredCatalogTranslation {
    readonly bundle: string;
    /** Slash-separated authored instance names; `$` selects a TextField root. */
    readonly target: string;
    readonly text: string;
}

/**
 * Small locale sidecar layered over one locale-neutral native catalog.
 * Editable strings and baked-text images vary without duplicating hierarchy or
 * timeline bytes. A structurally different locale remains a normal full
 * catalog instead of being forced through this overlay.
 */
export interface AuthoredContentLocaleManifest {
    readonly schema: typeof AUTHORED_CONTENT_LOCALE_SCHEMA;
    readonly id: string;
    readonly locale: string;
    readonly baseCatalog: string;
    readonly assetOverrides: readonly AuthoredCatalogAssetOverride[];
    readonly translations: readonly AuthoredCatalogTranslation[];
}

export interface AuthoredCatalogLoader {
    load(url: string, type?: string): Promise<unknown>;
}

export interface AuthoredCatalogRuntimeBinding<T extends Node = Node> {
    readonly runtimeId: string;
    readonly ctor: new (...args: any[]) => T;
    readonly validate?: (root: T) => void;
}

export interface AuthoredContentCatalogOptions {
    readonly baseUrl: string;
    readonly loader: AuthoredCatalogLoader;
    readonly applicationDomain?: ApplicationDomain;
    readonly runtimeBindings?: readonly AuthoredCatalogRuntimeBinding<any>[];
    readonly fontCatalogOptions?: Omit<AuthoredFontCatalogLoadOptions, "applicationDomain">;
}

export interface AuthoredContentCatalogLoadOptions
    extends Omit<AuthoredContentCatalogOptions, "baseUrl"> {
}

export interface AuthoredContentCatalogActivation {
    readonly manifest: AuthoredContentCatalogManifest;
    readonly fontCatalogs: readonly AuthoredFontCatalogActivation[];
    create(bundleId: string): Node;
    definitionFor(linkage: string): AuthoredPrefabDefinition<Node>;
    prefabFor(bundleId: string): Prefab;
}

type NormalizedCatalog = {
    readonly manifest: AuthoredContentCatalogManifest;
    readonly fingerprint: string;
};

type NormalizedLocaleOverlay = {
    readonly manifest: AuthoredContentLocaleManifest;
    readonly fingerprint: string;
};

type InstalledCatalog = {
    readonly fingerprint: string;
    readonly bindings: ReadonlyMap<string, AuthoredCatalogRuntimeBinding<any>>;
    readonly promise: Promise<AuthoredContentCatalogActivation>;
};

const SOURCE_TYPES = { DisplayObject, MovieClip, SimpleButton, Sprite, TextField } as const;
const SERIALIZED_TYPES: Readonly<Record<AuthoredSourceType, "Sprite" | "Input">> = {
    DisplayObject: "Sprite",
    MovieClip: "Sprite",
    SimpleButton: "Sprite",
    Sprite: "Sprite",
    TextField: "Sprite",
};
const installedCatalogs = new WeakMap<ApplicationDomain, Map<string, InstalledCatalog>>();

/**
 * Maps the logical Flash resource requested by the game to its native Laya
 * catalog sidecar. Locale-specific Resources URLs share the en_Eu native
 * catalog: non-base locales select an adjacent locale map without requiring a
 * duplicate locale asset tree. CDN root, query, and fragment are preserved.
 */
export function authoredContentCatalogUrlForResource(resourceUrlValue: string): string {
    const resourceUrl = requireNonemptyString(resourceUrlValue, "resourceUrl");
    const queryIndex = resourceUrl.indexOf("?");
    const fragmentIndex = resourceUrl.indexOf("#");
    const suffixIndex = queryIndex === -1
        ? fragmentIndex
        : fragmentIndex === -1 ? queryIndex : Math.min(queryIndex, fragmentIndex);
    const address = suffixIndex === -1 ? resourceUrl : resourceUrl.slice(0, suffixIndex);
    const transportSuffix = suffixIndex === -1 ? "" : resourceUrl.slice(suffixIndex);
    if (!address.toLowerCase().endsWith(".swf"))
        throw new TypeError("resourceUrl must identify a .swf resource");
    const resourceLocale = /(^|\/)Resources\/([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\//.exec(address);
    if (resourceLocale && resourceLocale[2] !== AUTHORED_CONTENT_BASE_LOCALE) {
        const prefix = address.slice(0, resourceLocale.index);
        const localizedSuffix = address.slice(resourceLocale.index + resourceLocale[0].length, -4);
        return `${prefix}${resourceLocale[1]}Resources/${AUTHORED_CONTENT_BASE_LOCALE}/${localizedSuffix}.${resourceLocale[2]}.locale.json${transportSuffix}`;
    }
    return `${address.slice(0, -4)}${AUTHORED_CONTENT_CATALOG_SUFFIX}${transportSuffix}`;
}

/** Loads the native catalog that replaces one logical SWF resource. */
export function loadAndActivateAuthoredContentResource(
    resourceUrl: string,
    options: AuthoredContentCatalogLoadOptions,
): Promise<AuthoredContentCatalogActivation> {
    return loadAndActivateAuthoredContentCatalog(
        authoredContentCatalogUrlForResource(resourceUrl),
        options,
    );
}

/** Loads a generated catalog JSON and derives all asset URLs from its directory. */
export async function loadAndActivateAuthoredContentCatalog(
    catalogUrlValue: string,
    options: AuthoredContentCatalogLoadOptions,
): Promise<AuthoredContentCatalogActivation> {
    const catalogUrl = requireNonemptyString(catalogUrlValue, "catalogUrl");
    const loader = requireLoader(options?.loader);
    const loaded = await loader.load(catalogUrl, Loader.JSON);
    if (!loaded) throw new Error(`Authored content catalog failed to load: ${catalogUrl}`);
    let value: unknown = loaded;
    if (loaded instanceof TextResource) {
        if (loaded.format !== TextResourceFormat.JSON)
            throw new TypeError("Authored content catalog loader returned a non-JSON TextResource");
        value = loaded.data;
    }
    if (isLocaleOverlay(value)) {
        const overlay = normalizeLocaleOverlay(value);
        const overlayBaseUrl = URL.getPath(catalogUrl);
        const baseCatalogUrl = resolveCatalogReference(overlayBaseUrl, overlay.manifest.baseCatalog);
        const baseLoaded = await loader.load(baseCatalogUrl, Loader.JSON);
        if (!baseLoaded) throw new Error(`Authored content base catalog failed to load: ${baseCatalogUrl}`);
        let baseValue: unknown = baseLoaded;
        if (baseLoaded instanceof TextResource) {
            if (baseLoaded.format !== TextResourceFormat.JSON)
                throw new TypeError("Authored content base catalog loader returned a non-JSON TextResource");
            baseValue = baseLoaded.data;
        }
        const catalog = normalizeCatalog(baseValue);
        const localized = resolveLocaleOverlay(overlay, catalog.manifest, overlayBaseUrl);
        return activateNormalizedCatalog(catalog, {
            ...options,
            loader,
            baseUrl: URL.getPath(baseCatalogUrl),
        }, {
            assetUrls: localized.assetUrls,
            cacheKey: `${catalog.manifest.id}\n${catalogUrl}`,
            fingerprint: `${catalog.fingerprint}\n${overlay.fingerprint}`,
            translations: localized.translations,
        });
    }
    return activateAuthoredContentCatalog(value, {
        ...options,
        loader,
        baseUrl: URL.getPath(catalogUrl),
    });
}

/**
 * Loads and publishes a generated authored-content catalog through the normal
 * Laya asset database, hierarchy loader, runtime class registry and Flash
 * definition domain. Applications provide data plus optional behavior-bearing
 * root types; they do not reproduce those mechanics per asset family.
 */
export function activateAuthoredContentCatalog(
    value: unknown,
    options: AuthoredContentCatalogOptions,
): Promise<AuthoredContentCatalogActivation> {
    const catalog = normalizeCatalog(value);
    return activateNormalizedCatalog(catalog, options);
}

function activateNormalizedCatalog(
    catalog: NormalizedCatalog,
    options: AuthoredContentCatalogOptions,
    localized?: {
        readonly assetUrls: ReadonlyMap<string, string>;
        readonly cacheKey: string;
        readonly fingerprint: string;
        readonly translations: ReadonlyMap<string, readonly AuthoredCatalogTranslation[]>;
    },
): Promise<AuthoredContentCatalogActivation> {
    const baseUrl = requireBaseUrl(options?.baseUrl);
    const loader = requireLoader(options?.loader);
    const domain = options.applicationDomain ?? ApplicationDomain.currentDomain;
    if (!(domain instanceof ApplicationDomain))
        throw new TypeError("Authored content catalog requires an ApplicationDomain");
    const bindings = normalizeBindings(options.runtimeBindings ?? [], catalog.manifest);
    const key = localized?.cacheKey ?? `${catalog.manifest.id}\n${baseUrl}`;
    let byKey = installedCatalogs.get(domain);
    if (!byKey) installedCatalogs.set(domain, byKey = new Map());
    const existing = byKey.get(key);
    if (existing) {
        if (existing.fingerprint !== (localized?.fingerprint ?? catalog.fingerprint))
            throw new Error(`Authored content catalog '${catalog.manifest.id}' changed after activation`);
        if (!sameBindings(existing.bindings, bindings))
            throw new Error(`Authored content catalog '${catalog.manifest.id}' runtime bindings changed after activation`);
        return existing.promise;
    }
    const promise = activate(
        catalog.manifest,
        baseUrl,
        loader,
        domain,
        bindings,
        localized?.assetUrls ?? new Map(),
        localized?.translations ?? new Map(),
        options.fontCatalogOptions,
    );
    byKey.set(key, { fingerprint: localized?.fingerprint ?? catalog.fingerprint, bindings, promise });
    promise.catch(() => {
        if (byKey!.get(key)?.promise === promise) byKey!.delete(key);
    });
    return promise;
}

async function activate(
    manifest: AuthoredContentCatalogManifest,
    baseUrl: string,
    loader: AuthoredCatalogLoader,
    domain: ApplicationDomain,
    bindings: ReadonlyMap<string, AuthoredCatalogRuntimeBinding<any>>,
    localizedAssetUrls: ReadonlyMap<string, string>,
    translations: ReadonlyMap<string, readonly AuthoredCatalogTranslation[]>,
    fontCatalogOptions: Omit<AuthoredFontCatalogLoadOptions, "applicationDomain"> | undefined,
): Promise<AuthoredContentCatalogActivation> {
    const runtimeLinkages: AuthoredRuntimeLinkage[] = [];
    const assetClaims: Array<{ id: string; url: string; previous: string | undefined }> = [];
    try {
        for (const bundle of manifest.bundles) {
            const binding = bindings.get(bundle.runtimeId);
            const ctor = binding?.ctor ?? SOURCE_TYPES[bundle.sourceType];
            runtimeLinkages.push({
                id: bundle.runtimeId,
                ctor,
                sourceType: bundle.sourceType,
                serializedType: SERIALIZED_TYPES[bundle.sourceType],
            });
            registerAssetUrls(baseUrl, bundle, localizedAssetUrls, assetClaims);
        }
        registerAuthoredContentRuntime(runtimeLinkages);

        const assetLoads: Promise<unknown>[] = [];
        const assetLabels: string[] = [];
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) {
                assetLabels.push(`${bundle.id}:${asset.path}`);
                const assetUrl = localizedAssetUrls.get(asset.id) ?? URL.join(baseUrl, asset.path);
                assetLoads.push(loader.load(
                    assetUrl,
                    asset.kind === "image" ? Loader.IMAGE : undefined,
                ));
            }
        }
        const assets = await Promise.all(assetLoads);
        const missingAsset = assets.findIndex(asset => !asset);
        if (missingAsset !== -1)
            throw new Error(`Authored content catalog asset failed to load: ${assetLabels[missingAsset]}`);

        const fontStartupUrls = [...new Set(manifest.bundles
            .map(bundle => bundle.fontStartup)
            .filter((value): value is string => value !== undefined)
            .map(value => URL.join(baseUrl, value)))];
        const fontCatalogs = await Promise.all(fontStartupUrls.map(startupUrl =>
            loadAndActivateAuthoredFontCatalog(startupUrl, {
                ...fontCatalogOptions,
                applicationDomain: domain,
                fetch: fontCatalogOptions?.fetch ?? catalogFontFetch(loader),
            })));

        const loaded = await Promise.all(manifest.bundles.map(async bundle => {
            const prefabUrl = URL.join(baseUrl, bundle.prefab);
            const prefab = await loader.load(prefabUrl, Loader.HIERARCHY) as Prefab | null;
            if (!prefab || typeof prefab.create !== "function")
                throw new Error(`Authored content catalog prefab failed to load: ${prefabUrl}`);
            return [bundle, prefab] as const;
        }));

        const prefabs = new Map<string, Prefab>();
        const definitions = new Map<string, AuthoredPrefabDefinition<Node>>();
        for (const [bundle, prefab] of loaded) {
            const binding = bindings.get(bundle.runtimeId);
            const ctor = binding?.ctor ?? SOURCE_TYPES[bundle.sourceType];
            const baseDefinition = createAuthoredPrefabDefinition(bundle.runtimeId, prefab, ctor);
            const definition = localizeDefinition(baseDefinition, translations.get(bundle.id) ?? []);
            const root = new definition();
            try {
                binding?.validate?.(root);
            } finally {
                root.destroy(true);
            }
            prefabs.set(bundle.id, prefab);
            definitions.set(bundle.linkage, definition);
        }
        for (const bundle of manifest.bundles) {
            if (domain.hasDefinition(bundle.linkage))
                throw new Error(`Authored content definition collision: ${bundle.linkage}`);
        }
        for (const bundle of manifest.bundles)
            domain.registerDefinition(bundle.linkage, definitions.get(bundle.linkage)!);

        return Object.freeze({
            manifest,
            fontCatalogs: Object.freeze(fontCatalogs),
            create(bundleId: string): Node {
                const bundle = manifest.bundles.find(candidate => candidate.id === bundleId);
                if (!bundle) throw new Error(`Unknown authored content bundle '${bundleId}'`);
                return new (definitions.get(bundle.linkage)!)();
            },
            definitionFor(linkage: string): AuthoredPrefabDefinition<Node> {
                const definition = definitions.get(linkage);
                if (!definition) throw new Error(`Unknown authored content linkage '${linkage}'`);
                return definition;
            },
            prefabFor(bundleId: string): Prefab {
                const prefab = prefabs.get(bundleId);
                if (!prefab) throw new Error(`Unknown authored content bundle '${bundleId}'`);
                return prefab;
            },
        });
    } catch (error) {
        for (let index = assetClaims.length - 1; index >= 0; index -= 1) {
            const claim = assetClaims[index];
            if (AssetDb.inst.uuidMap[claim.id] !== claim.url) continue;
            if (claim.previous === undefined) delete AssetDb.inst.uuidMap[claim.id];
            else AssetDb.inst.uuidMap[claim.id] = claim.previous;
        }
        throw error;
    }
}

function registerAssetUrls(
    baseUrl: string,
    bundle: AuthoredCatalogBundle,
    localizedAssetUrls: ReadonlyMap<string, string>,
    claims: Array<{ id: string; url: string; previous: string | undefined }>,
): void {
    for (const asset of bundle.assets) {
        const assetUrl = localizedAssetUrls.get(asset.id) ?? URL.join(baseUrl, asset.path);
        const existing = AssetDb.inst.uuidMap[asset.id];
        if (existing !== undefined && existing !== assetUrl)
            throw new Error(`Authored content asset identity collision: ${asset.id}`);
        if (existing === undefined) {
            claims.push({ id: asset.id, url: assetUrl, previous: existing });
            AssetDb.inst.uuidMap[asset.id] = assetUrl;
        }
    }
}

/** Adapts the catalog's authenticated Laya loader to the font catalog fetch seam. */
function catalogFontFetch(loader: AuthoredCatalogLoader): NonNullable<AuthoredFontCatalogLoadOptions["fetch"]> {
    return async (input, init): Promise<AuthoredFontCatalogResponse> => {
        if (init.signal?.aborted) throw init.signal.reason;
        const loaded = await loader.load(input, Loader.BUFFER);
        let buffer: ArrayBuffer | null = null;
        if (loaded instanceof ArrayBuffer)
            buffer = loaded.slice(0);
        else if (ArrayBuffer.isView(loaded))
            buffer = loaded.buffer.slice(loaded.byteOffset, loaded.byteOffset + loaded.byteLength) as ArrayBuffer;
        return {
            ok: buffer !== null,
            status: buffer === null ? 404 : 200,
            async arrayBuffer(): Promise<ArrayBuffer> {
                if (buffer === null) throw new Error(`Authored font catalog failed to load: ${input}`);
                return buffer.slice(0);
            },
        };
    };
}

function normalizeCatalog(value: unknown): NormalizedCatalog {
    const source = requirePlainRecord(value, "catalog");
    requireExactKeys(source, ["schema", "id", "bundles"], "catalog");
    if (source.schema !== AUTHORED_CONTENT_CATALOG_SCHEMA)
        throw new TypeError(`catalog.schema must equal ${AUTHORED_CONTENT_CATALOG_SCHEMA}`);
    const id = requireNonemptyString(source.id, "catalog.id");
    if (!Array.isArray(source.bundles) || source.bundles.length === 0)
        throw new TypeError("catalog.bundles must be a non-empty array");
    const bundleIds = new Set<string>();
    const runtimeIds = new Set<string>();
    const linkages = new Set<string>();
    const assetIds = new Set<string>();
    const bundles = source.bundles.map((entry, index): AuthoredCatalogBundle => {
        const path = `catalog.bundles[${index}]`;
        const bundle = requirePlainRecord(entry, path);
        const hasFontStartup = Object.prototype.hasOwnProperty.call(bundle, "fontStartup");
        requireExactKeys(bundle, [
            "id", "runtimeId", "linkage", "sourceType", "prefab", "assets",
            ...(hasFontStartup ? ["fontStartup"] : []),
        ], path);
        const bundleId = requireUnique(bundle.id, `${path}.id`, bundleIds);
        const runtimeId = requireUniqueApplicationId(bundle.runtimeId, `${path}.runtimeId`, runtimeIds);
        const linkage = requireUniqueApplicationId(bundle.linkage, `${path}.linkage`, linkages);
        const sourceType = bundle.sourceType as AuthoredSourceType;
        if (!(sourceType in SOURCE_TYPES)) throw new TypeError(`${path}.sourceType is unsupported`);
        const prefab = requireRelativePath(bundle.prefab, `${path}.prefab`);
        const fontStartup = hasFontStartup
            ? requireRelativePath(bundle.fontStartup, `${path}.fontStartup`)
            : undefined;
        if (!Array.isArray(bundle.assets)) throw new TypeError(`${path}.assets must be an array`);
        const assets = bundle.assets.map((assetValue, assetIndex): AuthoredCatalogAsset => {
            const assetPath = `${path}.assets[${assetIndex}]`;
            const asset = requirePlainRecord(assetValue, assetPath);
            requireExactKeys(asset, ["id", "path", "kind"], assetPath);
            const assetId = requireUnique(asset.id, `${assetPath}.id`, assetIds);
            const outputPath = requireRelativePath(asset.path, `${assetPath}.path`);
            if (asset.kind !== "image" && asset.kind !== "timeline")
                throw new TypeError(`${assetPath}.kind must be image or timeline`);
            return Object.freeze({ id: assetId, path: outputPath, kind: asset.kind });
        });
        return Object.freeze({
            id: bundleId, runtimeId, linkage, sourceType, prefab,
            ...(fontStartup === undefined ? {} : { fontStartup }),
            assets: Object.freeze(assets),
        });
    });
    const manifest = Object.freeze({ schema: AUTHORED_CONTENT_CATALOG_SCHEMA, id, bundles: Object.freeze(bundles) });
    return { manifest, fingerprint: JSON.stringify(manifest) };
}

function isLocaleOverlay(value: unknown): boolean {
    return !!value && typeof value === "object"
        && (value as Record<string, unknown>).schema === AUTHORED_CONTENT_LOCALE_SCHEMA;
}

function normalizeLocaleOverlay(value: unknown): NormalizedLocaleOverlay {
    const source = requirePlainRecord(value, "locale overlay");
    requireExactKeys(
        source,
        ["schema", "id", "locale", "baseCatalog", "assetOverrides", "translations"],
        "locale overlay",
    );
    if (source.schema !== AUTHORED_CONTENT_LOCALE_SCHEMA)
        throw new TypeError(`locale overlay.schema must equal ${AUTHORED_CONTENT_LOCALE_SCHEMA}`);
    const id = requireNonemptyString(source.id, "locale overlay.id");
    const locale = requireLocale(source.locale, "locale overlay.locale");
    const baseCatalog = requireCatalogReference(source.baseCatalog, "locale overlay.baseCatalog");
    if (!Array.isArray(source.assetOverrides))
        throw new TypeError("locale overlay.assetOverrides must be an array");
    if (!Array.isArray(source.translations))
        throw new TypeError("locale overlay.translations must be an array");
    const assetIds = new Set<string>();
    const assetOverrides = source.assetOverrides.map((value, index): AuthoredCatalogAssetOverride => {
        const path = `locale overlay.assetOverrides[${index}]`;
        const record = requirePlainRecord(value, path);
        requireExactKeys(record, ["id", "path"], path);
        return Object.freeze({
            id: requireUnique(record.id, `${path}.id`, assetIds),
            path: requireRelativePath(record.path, `${path}.path`),
        });
    });
    const targets = new Set<string>();
    const translations = source.translations.map((value, index): AuthoredCatalogTranslation => {
        const path = `locale overlay.translations[${index}]`;
        const record = requirePlainRecord(value, path);
        requireExactKeys(record, ["bundle", "target", "text"], path);
        const bundle = requireNonemptyString(record.bundle, `${path}.bundle`);
        const target = requireLocalizationTarget(record.target, `${path}.target`);
        const identity = `${bundle}\n${target}`;
        if (targets.has(identity)) throw new Error(`${path} duplicates '${bundle}/${target}'`);
        targets.add(identity);
        if (typeof record.text !== "string") throw new TypeError(`${path}.text must be a string`);
        return Object.freeze({ bundle, target, text: record.text });
    });
    const manifest = Object.freeze({
        schema: AUTHORED_CONTENT_LOCALE_SCHEMA,
        id,
        locale,
        baseCatalog,
        assetOverrides: Object.freeze(assetOverrides),
        translations: Object.freeze(translations),
    });
    return { manifest, fingerprint: JSON.stringify(manifest) };
}

function resolveLocaleOverlay(
    overlay: NormalizedLocaleOverlay,
    catalog: AuthoredContentCatalogManifest,
    overlayBaseUrl: string,
): {
    readonly assetUrls: ReadonlyMap<string, string>;
    readonly translations: ReadonlyMap<string, readonly AuthoredCatalogTranslation[]>;
} {
    const assets = new Map<string, AuthoredCatalogAsset>();
    const bundles = new Set(catalog.bundles.map(bundle => bundle.id));
    for (const bundle of catalog.bundles) for (const asset of bundle.assets) assets.set(asset.id, asset);
    const assetUrls = new Map<string, string>();
    for (const override of overlay.manifest.assetOverrides) {
        const asset = assets.get(override.id);
        if (!asset) throw new Error(`Locale overlay asset '${override.id}' is not declared by the base catalog`);
        if (asset.kind !== "image")
            throw new Error(`Locale overlay asset '${override.id}' must be an image; structural timelines require a full catalog`);
        assetUrls.set(override.id, URL.join(overlayBaseUrl, override.path));
    }
    const translationLists = new Map<string, AuthoredCatalogTranslation[]>();
    for (const translation of overlay.manifest.translations) {
        if (!bundles.has(translation.bundle))
            throw new Error(`Locale overlay translation bundle '${translation.bundle}' is not declared by the base catalog`);
        const list = translationLists.get(translation.bundle) ?? [];
        list.push(translation);
        translationLists.set(translation.bundle, list);
    }
    return {
        assetUrls,
        translations: new Map([...translationLists].map(([id, values]) => [id, Object.freeze(values)])),
    };
}

function localizeDefinition(
    definition: AuthoredPrefabDefinition<Node>,
    translations: readonly AuthoredCatalogTranslation[],
): AuthoredPrefabDefinition<Node> {
    if (translations.length === 0) return definition;
    const localized = function(this: unknown): Node {
        const root = new definition();
        try {
            for (const translation of translations) {
                const target = resolveTranslationTarget(root, translation.target);
                applyAuthoredLocaleText(target, translation.text);
            }
            return root;
        } catch (error) {
            root.destroy(true);
            throw error;
        }
    } as unknown as AuthoredPrefabDefinition<Node>;
    localized.prototype = definition.prototype;
    return localized;
}

function resolveTranslationTarget(root: Node, target: string): TextField {
    let current: Node | null = root;
    if (target !== "$") {
        for (const segment of target.split("/")) {
            current = current === null ? null
                : current.getChildByName(segment) ?? resolveGeneratedTextPlacement(current, segment, target);
            if (current === null) throw new Error(`Authored locale text target '${target}' is missing`);
        }
    }
    if (!(current instanceof TextField))
        throw new TypeError(`Authored locale text target '${target}' must be a TextField`);
    return current;
}

function resolveGeneratedTextPlacement(parent: Node, segment: string, target: string): TextField | null {
    const generated = /^character_(\d+)\$d\d+\$f\d+\$i\d+$/.exec(segment);
    if (!generated) return null;
    const sourceId = Number(generated[1]);
    const candidates: TextField[] = [];
    for (let index = 0; index < parent.numChildren; index++) {
        const child = parent.getChildAt(index);
        if (!(child instanceof TextField)) continue;
        const configuration = (child as TextField & { readonly authoredConfiguration?: unknown }).authoredConfiguration;
        if (configuration && typeof configuration === "object"
            && (configuration as { readonly sourceId?: unknown }).sourceId === sourceId)
            candidates.push(child);
    }
    if (candidates.length > 1)
        throw new Error(`Authored locale text target '${target}' has an ambiguous generated placement identity`);
    return candidates[0] ?? null;
}

function normalizeBindings(
    values: readonly AuthoredCatalogRuntimeBinding<any>[],
    manifest: AuthoredContentCatalogManifest,
): ReadonlyMap<string, AuthoredCatalogRuntimeBinding<any>> {
    if (!Array.isArray(values)) throw new TypeError("runtimeBindings must be an array");
    const result = new Map<string, AuthoredCatalogRuntimeBinding<any>>();
    const bundleByRuntime = new Map(manifest.bundles.map(bundle => [bundle.runtimeId, bundle]));
    for (const [index, binding] of values.entries()) {
        if (!binding || typeof binding !== "object") throw new TypeError(`runtimeBindings[${index}] must be an object`);
        const runtimeId = requireNonemptyString(binding.runtimeId, `runtimeBindings[${index}].runtimeId`);
        const bundle = bundleByRuntime.get(runtimeId);
        if (!bundle) throw new Error(`Runtime binding '${runtimeId}' is not declared by the catalog`);
        if (result.has(runtimeId)) throw new Error(`Duplicate runtime binding '${runtimeId}'`);
        const expected = SOURCE_TYPES[bundle.sourceType];
        if (typeof binding.ctor !== "function"
            || (binding.ctor !== expected && !(binding.ctor.prototype instanceof expected)))
            throw new TypeError(`Runtime binding '${runtimeId}' must extend ${bundle.sourceType}`);
        if (binding.validate !== undefined && typeof binding.validate !== "function")
            throw new TypeError(`Runtime binding '${runtimeId}' validate must be a function`);
        result.set(runtimeId, Object.freeze({ runtimeId, ctor: binding.ctor, validate: binding.validate }));
    }
    return result;
}

function requireLoader(value: AuthoredCatalogLoader | undefined): AuthoredCatalogLoader {
    if (!value || typeof value !== "object" || typeof value.load !== "function")
        throw new TypeError("Authored content catalog requires the native Laya asset loader");
    return value;
}

function requireBaseUrl(value: unknown): string {
    const url = requireNonemptyString(value, "baseUrl");
    if (!url.endsWith("/")) throw new TypeError("baseUrl must end with '/'");
    return url;
}

function requireLocale(value: unknown, path: string): string {
    const locale = requireNonemptyString(value, path);
    if (!/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(locale))
        throw new TypeError(`${path} must be one normalized locale segment`);
    return locale;
}

function requireCatalogReference(value: unknown, path: string): string {
    const text = requireNonemptyString(value, path);
    if (text.includes("\\") || text.includes("?") || text.includes("#")
        || text.split("/").some((part, index) => index > 0 && (part.length === 0 || part === "." || part === ".."))
        || !text.toLowerCase().endsWith(AUTHORED_CONTENT_CATALOG_SUFFIX))
        throw new TypeError(`${path} must be a normalized catalog URL without query or fragment`);
    return text;
}

function resolveCatalogReference(baseUrl: string, reference: string): string {
    return reference.startsWith("/") ? reference : URL.join(baseUrl, reference);
}

function requireLocalizationTarget(value: unknown, path: string): string {
    const target = requireNonemptyString(value, path);
    if (target === "$") return target;
    if (target.includes("\\") || target.split("/").some(part => part.length === 0 || part === "." || part === ".."))
        throw new TypeError(`${path} must be a normalized authored instance path`);
    return target;
}

function requirePlainRecord(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        throw new TypeError(`${path} must be a plain object`);
    return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
        throw new TypeError(`${path} must contain exactly ${expected.join(", ")}`);
}

function requireNonemptyString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${path} must be a non-empty string`);
    return value;
}

function requireUnique(value: unknown, path: string, seen: Set<string>): string {
    const text = requireNonemptyString(value, path);
    if (seen.has(text)) throw new Error(`${path} duplicates '${text}'`);
    seen.add(text);
    return text;
}

function requireUniqueApplicationId(value: unknown, path: string, seen: Set<string>): string {
    const text = requireUnique(value, path, seen);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(text)
        || text === "flash" || text.startsWith("flash.") || text === "laya" || text.startsWith("laya."))
        throw new TypeError(`${path} must be an application-owned linkage ID`);
    return text;
}

function sameBindings(
    left: ReadonlyMap<string, AuthoredCatalogRuntimeBinding<any>>,
    right: ReadonlyMap<string, AuthoredCatalogRuntimeBinding<any>>,
): boolean {
    if (left.size !== right.size) return false;
    for (const [runtimeId, binding] of left) {
        const other = right.get(runtimeId);
        if (!other || other.ctor !== binding.ctor || other.validate !== binding.validate) return false;
    }
    return true;
}

function requireRelativePath(value: unknown, path: string): string {
    const text = requireNonemptyString(value, path);
    if (text.startsWith("/") || text.startsWith("\\") || text.includes("\\")
        || text.split("/").some(part => part.length === 0 || part === "." || part === "..")
        || text.includes("?") || text.includes("#"))
        throw new TypeError(`${path} must be a normalized relative asset path`);
    return text;
}
