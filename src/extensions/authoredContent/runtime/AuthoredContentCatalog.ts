import { Node } from "../../../layaAir/laya/display/Node";
import { Loader } from "../../../layaAir/laya/net/Loader";
import { URL } from "../../../layaAir/laya/net/URL";
import { AssetDb } from "../../../layaAir/laya/resource/AssetDb";
import type { Prefab } from "../../../layaAir/laya/resource/HierarchyResource";
import { DisplayObject, MovieClip, SimpleButton, Sprite, TextField } from "../../../layaAir/flash";
import { ApplicationDomain } from "../../../layaAir/flash/system/ApplicationDomain";
import {
    createAuthoredPrefabDefinition,
    registerAuthoredContentRuntime,
    type AuthoredPrefabDefinition,
    type AuthoredRuntimeLinkage,
    type AuthoredSourceType,
} from "./bootstrap";

export const AUTHORED_CONTENT_CATALOG_SCHEMA = "laya-authored-content-catalog@1" as const;
export const AUTHORED_CONTENT_CATALOG_SUFFIX = ".runtime-catalog.json" as const;

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
    readonly assets: readonly AuthoredCatalogAsset[];
}

export interface AuthoredContentCatalogManifest {
    readonly schema: typeof AUTHORED_CONTENT_CATALOG_SCHEMA;
    readonly id: string;
    readonly bundles: readonly AuthoredCatalogBundle[];
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
}

export interface AuthoredContentCatalogLoadOptions
    extends Omit<AuthoredContentCatalogOptions, "baseUrl"> {
}

export interface AuthoredContentCatalogActivation {
    readonly manifest: AuthoredContentCatalogManifest;
    create(bundleId: string): Node;
    definitionFor(linkage: string): AuthoredPrefabDefinition<Node>;
    prefabFor(bundleId: string): Prefab;
}

type NormalizedCatalog = {
    readonly manifest: AuthoredContentCatalogManifest;
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
 * catalog sidecar without changing the resource namespace, locale, CDN root,
 * cache query or fragment.
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
    const value = await loader.load(catalogUrl, Loader.JSON);
    if (!value) throw new Error(`Authored content catalog failed to load: ${catalogUrl}`);
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
    const baseUrl = requireBaseUrl(options?.baseUrl);
    const loader = requireLoader(options?.loader);
    const domain = options.applicationDomain ?? ApplicationDomain.currentDomain;
    if (!(domain instanceof ApplicationDomain))
        throw new TypeError("Authored content catalog requires an ApplicationDomain");
    const bindings = normalizeBindings(options.runtimeBindings ?? [], catalog.manifest);
    const key = `${catalog.manifest.id}\n${baseUrl}`;
    let byKey = installedCatalogs.get(domain);
    if (!byKey) installedCatalogs.set(domain, byKey = new Map());
    const existing = byKey.get(key);
    if (existing) {
        if (existing.fingerprint !== catalog.fingerprint)
            throw new Error(`Authored content catalog '${catalog.manifest.id}' changed after activation`);
        if (!sameBindings(existing.bindings, bindings))
            throw new Error(`Authored content catalog '${catalog.manifest.id}' runtime bindings changed after activation`);
        return existing.promise;
    }
    const promise = activate(catalog.manifest, baseUrl, loader, domain, bindings);
    byKey.set(key, { fingerprint: catalog.fingerprint, bindings, promise });
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
            registerAssetUrls(baseUrl, bundle, assetClaims);
        }
        registerAuthoredContentRuntime(runtimeLinkages);

        const assetLoads: Promise<unknown>[] = [];
        const assetLabels: string[] = [];
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) {
                assetLabels.push(`${bundle.id}:${asset.path}`);
                assetLoads.push(loader.load(
                    URL.join(baseUrl, asset.path),
                    asset.kind === "image" ? Loader.IMAGE : undefined,
                ));
            }
        }
        const assets = await Promise.all(assetLoads);
        const missingAsset = assets.findIndex(asset => !asset);
        if (missingAsset !== -1)
            throw new Error(`Authored content catalog asset failed to load: ${assetLabels[missingAsset]}`);

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
            const definition = createAuthoredPrefabDefinition(bundle.runtimeId, prefab, ctor);
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
    claims: Array<{ id: string; url: string; previous: string | undefined }>,
): void {
    for (const asset of bundle.assets) {
        const assetUrl = URL.join(baseUrl, asset.path);
        const existing = AssetDb.inst.uuidMap[asset.id];
        if (existing !== undefined && existing !== assetUrl)
            throw new Error(`Authored content asset identity collision: ${asset.id}`);
        if (existing === undefined) {
            claims.push({ id: asset.id, url: assetUrl, previous: existing });
            AssetDb.inst.uuidMap[asset.id] = assetUrl;
        }
    }
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
        requireExactKeys(bundle, ["id", "runtimeId", "linkage", "sourceType", "prefab", "assets"], path);
        const bundleId = requireUnique(bundle.id, `${path}.id`, bundleIds);
        const runtimeId = requireUniqueApplicationId(bundle.runtimeId, `${path}.runtimeId`, runtimeIds);
        const linkage = requireUniqueApplicationId(bundle.linkage, `${path}.linkage`, linkages);
        const sourceType = bundle.sourceType as AuthoredSourceType;
        if (!(sourceType in SOURCE_TYPES)) throw new TypeError(`${path}.sourceType is unsupported`);
        const prefab = requireRelativePath(bundle.prefab, `${path}.prefab`);
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
        return Object.freeze({ id: bundleId, runtimeId, linkage, sourceType, prefab, assets: Object.freeze(assets) });
    });
    const manifest = Object.freeze({ schema: AUTHORED_CONTENT_CATALOG_SCHEMA, id, bundles: Object.freeze(bundles) });
    return { manifest, fingerprint: JSON.stringify(manifest) };
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
