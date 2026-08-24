import * as crypto from "node:crypto";
import {
    NeutralAuthoredContentIR,
    NeutralAuthoredNode
} from "../core/NeutralAuthoredContentIR";
import { NativeLayaEmitter } from "./NativeLayaEmitter";
import { AUTHORED_CONTENT_RUNTIME_IDS } from "../core/AuthoredRuntimeIds";

export type NativeAuthoredContentBundleFileKind = "image" | "prefab" | "timeline";

export interface NativeAuthoredContentBundleFile {
    readonly path: string;
    readonly kind: NativeAuthoredContentBundleFileKind;
    readonly bytes: Uint8Array;
}

export interface NativeAuthoredContentBundle {
    readonly schema: "laya-native-authored-content-bundle@1";
    readonly files: ReadonlyArray<NativeAuthoredContentBundleFile>;
}

export interface NativeAuthoredContentTransaction {
    stage(path: string, bytes: Uint8Array): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

export interface NativeLayaBundlePreparation {
    readonly content: NeutralAuthoredContentIR;
    readonly hierarchy: Record<string, unknown>;
    readonly prefabPath: string;
    readonly timelinePath: string;
    readonly timelineAssetId: string;
    readonly timelineBytes: Uint8Array;
    readonly nestedTimelines?: ReadonlyArray<NativeNestedTimelinePublication>;
    readonly resourceAssetIds: ReadonlyMap<string, string>;
    readonly resourcePayloads: ReadonlyMap<string, Uint8Array>;
    readonly sha256: (bytes: Uint8Array) => string | Promise<string>;
}

export interface NativeNestedTimelinePublication {
    readonly semanticPath: string;
    readonly timelinePath: string;
    readonly timelineAssetId: string;
    readonly timelineBytes: Uint8Array;
}

/**
 * Authenticates the complete resource closure and produces deterministic bytes
 * for a standard Laya .lh/.mc/image bundle. No files are written here.
 */
export async function prepareNativeLayaAuthoredContentBundle(
    preparation: NativeLayaBundlePreparation
): Promise<NativeAuthoredContentBundle> {
    const {
        content,
        timelineAssetId,
        resourceAssetIds,
        resourcePayloads
    } = preparation;
    const prefabPath = canonicalOutputPath(preparation.prefabPath, ".lh", "prefabPath");
    const timelinePath = canonicalOutputPath(preparation.timelinePath, ".mc", "timelinePath");
    if (typeof timelineAssetId !== "string" || timelineAssetId.length === 0 || timelineAssetId.indexOf("\0") >= 0)
        fail("AUTHORED_CONTENT_NATIVE_TIMELINE_ID_REQUIRED", "timelineAssetId must be a stable non-empty string.");
    if (!(preparation.timelineBytes instanceof Uint8Array) || preparation.timelineBytes.byteLength === 0)
        fail("AUTHORED_CONTENT_NATIVE_TIMELINE_BYTES_REQUIRED", "timelineBytes must be non-empty native .mc bytes.");

    const nestedTimelines = normalizeNestedTimelinePublications(content.root, preparation.nestedTimelines ?? []);
    const nestedTimelineAssetIds = new Map(nestedTimelines.map(timeline => [
        timeline.semanticPath,
        timeline.timelineAssetId,
    ]));

    assertExactKeys(resourceAssetIds, content.resources.map(resource => resource.id), "RESOURCE_BINDING");
    assertExactKeys(resourcePayloads, content.resources.map(resource => resource.id), "RESOURCE_PAYLOAD");
    const hierarchy = prepareNativeLayaHierarchy(
        content,
        preparation.hierarchy,
        timelineAssetId,
        resourceAssetIds,
        nestedTimelineAssetIds
    );
    const files: NativeAuthoredContentBundleFile[] = [{
        path: prefabPath,
        kind: "prefab",
        bytes: canonicalJsonBytes(hierarchy)
    }, {
        path: timelinePath,
        kind: "timeline",
        bytes: cloneBytes(preparation.timelineBytes)
    }];
    for (const timeline of nestedTimelines) {
        files.push({
            path: timeline.timelinePath,
            kind: "timeline",
            bytes: cloneBytes(timeline.timelineBytes),
        });
    }
    for (const resource of content.resources) {
        const payload = resourcePayloads.get(resource.id)!;
        if (!(payload instanceof Uint8Array))
            fail("AUTHORED_CONTENT_RESOURCE_BYTES_REQUIRED", `Resource '${resource.id}' is not a Uint8Array.`);
        if (payload.byteLength !== resource.byteLength)
            fail("AUTHORED_CONTENT_RESOURCE_SIZE_MISMATCH", `Resource '${resource.id}' byte length drifted.`);
        const digest = await preparation.sha256(payload);
        if (digest !== resource.sha256)
            fail("AUTHORED_CONTENT_RESOURCE_HASH_MISMATCH", `Resource '${resource.id}' SHA-256 drifted.`);
        files.push({ path: resource.outputPath, kind: "image", bytes: cloneBytes(payload) });
    }
    files.sort((left, right) => compareText(left.path, right.path));
    const paths = files.map(file => file.path);
    if (new Set(paths.map(path => path.toLocaleLowerCase("en-US"))).size !== paths.length)
        fail("AUTHORED_CONTENT_NATIVE_OUTPUT_COLLISION", "Native output paths collide.");
    const bundle = Object.freeze({
        schema: "laya-native-authored-content-bundle@1" as const,
        files: Object.freeze(files.map(file => Object.freeze(file)))
    });
    sealedBundleAuthorities.set(bundle, Object.freeze(bundle.files.map(file => Object.freeze({
        path: file.path,
        byteLength: file.bytes.byteLength,
        sha256: hashBytes(file.bytes)
    }))));
    return bundle;
}

/** Stages every byte before commit and always rolls back an incomplete transaction. */
export async function writeNativeLayaAuthoredContentTransaction(
    bundle: NativeAuthoredContentBundle,
    transaction: NativeAuthoredContentTransaction
): Promise<void> {
    if (!transaction || typeof transaction.stage !== "function"
        || typeof transaction.commit !== "function" || typeof transaction.rollback !== "function")
        fail("AUTHORED_CONTENT_NATIVE_TRANSACTION_REQUIRED", "A complete transactional output host is required.");
    const authority = sealedBundleAuthorities.get(bundle);
    if (!authority || authority.length !== bundle.files.length)
        fail("AUTHORED_CONTENT_NATIVE_BUNDLE_AUTHORITY_REQUIRED", "The native bundle was not prepared by the authenticated writer.");
    const authenticatedFiles: NativeAuthoredContentBundleFile[] = [];
    for (let index = 0; index < bundle.files.length; index++) {
        const file = bundle.files[index];
        const expected = authority[index];
        // Snapshot every file before the first awaited host call. Otherwise a
        // stage callback could mutate a later file after its validation and
        // before that later file is cloned.
        const bytes = cloneBytes(file.bytes);
        if (file.path !== expected.path || bytes.byteLength !== expected.byteLength
            || hashBytes(bytes) !== expected.sha256) {
            fail(
                "AUTHORED_CONTENT_NATIVE_BUNDLE_BYTES_MUTATED",
                `Prepared native file '${expected.path}' drifted before staging.`
            );
        }
        authenticatedFiles.push(Object.freeze({ path: expected.path, kind: file.kind, bytes }));
    }
    let committed = false;
    try {
        for (const file of authenticatedFiles)
            await transaction.stage(file.path, file.bytes);
        await transaction.commit();
        committed = true;
    }
    catch (error) {
        if (!committed) {
            try {
                await transaction.rollback();
            }
            catch (rollbackError) {
                throw aggregateFailure(
                    "AUTHORED_CONTENT_NATIVE_TRANSACTION_RECOVERY_FAILED",
                    [error, rollbackError]
                );
            }
        }
        throw error;
    }
}

export function prepareNativeLayaHierarchy(
    content: NeutralAuthoredContentIR,
    hierarchyValue: Record<string, unknown>,
    timelineAssetId: string,
    resourceAssetIds: ReadonlyMap<string, string>,
    nestedTimelineAssetIds: ReadonlyMap<string, string> = new Map()
): Record<string, unknown> {
    const hierarchy = canonicalClone(hierarchyValue, "hierarchy") as Record<string, unknown>;
    if (hierarchy._$ver !== 1)
        fail("AUTHORED_CONTENT_NATIVE_HIERARCHY_VERSION", "HierarchyWriter must emit Laya hierarchy version 1.");
    canonicalizeHierarchyIds(hierarchy);
    decorateAuthoredRuntime(content.root, hierarchy);
    validateHierarchyNode(content.root, hierarchy, resourceAssetIds, "root", true);
    sealTimelineAssetReferences(hierarchy, timelineAssetId, nestedTimelineAssetIds);
    hierarchy._$authoredContent = NativeLayaEmitter.createMetadataWithResourceBindings(
        content,
        timelineAssetId,
        resourceAssetIds,
        nestedTimelineAssetIds
    );
    hierarchy._$preloads = [
        ...content.resources.map(resource => `res://${resourceAssetIds.get(resource.id)!}`),
        `res://${timelineAssetId}`,
        ...[...nestedTimelineAssetIds.values()].map(assetId => `res://${assetId}`)
    ];
    hierarchy._$preloadTypes = [
        ...content.resources.map(() => "Texture2D"),
        "AnimationClip2D",
        ...[...nestedTimelineAssetIds].map(() => "AnimationClip2D")
    ];
    return hierarchy;
}

/**
 * Laya's hierarchy parser only routes `res://` references (or canonical UUID
 * syntax) through AssetDb. Authored bundles deliberately use readable,
 * namespaced logical IDs, so leaving an AnimationClip2D `_$uuid` bare makes
 * the parser reinterpret it relative to the prefab URL and silently decode a
 * null clip. Seal every admitted timeline reference to its catalog identity.
 */
function sealTimelineAssetReferences(
    hierarchy: Record<string, unknown>,
    rootTimelineAssetId: string,
    nestedTimelineAssetIds: ReadonlyMap<string, string>,
): void {
    const expected = new Set([rootTimelineAssetId, ...nestedTimelineAssetIds.values()]);
    visitJsonObjects(hierarchy, value => {
        if (value._$type !== "AnimationClip2D" || value._$uuid === undefined)
            return;
        if (typeof value._$uuid !== "string" || value._$uuid.length === 0)
            fail("AUTHORED_CONTENT_NATIVE_TIMELINE_REFERENCE_INVALID", "AnimationClip2D requires a stable asset reference.");
        const assetId = value._$uuid.startsWith("res://") ? value._$uuid.slice(6) : value._$uuid;
        if (!expected.has(assetId))
            fail("AUTHORED_CONTENT_NATIVE_TIMELINE_REFERENCE_UNKNOWN", `Unknown timeline asset reference '${assetId}'.`);
        value._$uuid = `res://${assetId}`;
    });
}

/**
 * LayaAir IDE hierarchy serialization assigns opaque node IDs randomly. They
 * are not authored identity, but `_$ref` values can point at them. Normalize
 * the complete ID graph before publication so identical authored input emits
 * byte-identical `.lh` files without breaking internal references.
 */
function canonicalizeHierarchyIds(hierarchy: Record<string, unknown>): void {
    const owners: Array<{ readonly value: Record<string, unknown>; readonly original: string }> = [];
    const originals = new Set<string>();
    visitJsonObjects(hierarchy, value => {
        if (!("_$id" in value))
            return;
        const original = value._$id;
        if (typeof original !== "string" || original.length === 0)
            fail("AUTHORED_CONTENT_NATIVE_HIERARCHY_ID_INVALID", "Hierarchy IDs must be non-empty strings.");
        if (originals.has(original))
            fail("AUTHORED_CONTENT_NATIVE_HIERARCHY_ID_DUPLICATE", `Hierarchy ID '${original}' is duplicated.`);
        originals.add(original);
        owners.push({ value, original });
    });

    const replacements = new Map(owners.map(({ original }, index) => [
        original,
        `authored-${(index + 1).toString(36).padStart(8, "0")}`,
    ]));
    owners.forEach(({ value, original }) => value._$id = replacements.get(original)!);

    visitJsonObjects(hierarchy, value => {
        if (!("_$ref" in value))
            return;
        const reference = value._$ref;
        if (typeof reference !== "string" || reference.length === 0)
            fail("AUTHORED_CONTENT_NATIVE_HIERARCHY_REFERENCE_INVALID", "Hierarchy references must be non-empty strings.");
        const replacement = replacements.get(reference);
        if (replacement === undefined)
            fail("AUTHORED_CONTENT_NATIVE_HIERARCHY_REFERENCE_DANGLING", `Hierarchy reference '${reference}' has no local ID.`);
        value._$ref = replacement;
    });
}

function visitJsonObjects(value: unknown, visitor: (value: Record<string, unknown>) => void): void {
    if (Array.isArray(value)) {
        value.forEach(child => visitJsonObjects(child, visitor));
        return;
    }
    if (value === null || typeof value !== "object")
        return;
    const object = value as Record<string, unknown>;
    visitor(object);
    Object.keys(object).sort(compareText).forEach(key => visitJsonObjects(object[key], visitor));
}

export function canonicalLayaHierarchyBytes(hierarchy: Record<string, unknown>): Uint8Array {
    return canonicalJsonBytes(hierarchy);
}

function validateHierarchyNode(
    source: NeutralAuthoredNode,
    value: Record<string, unknown>,
    resourceAssetIds: ReadonlyMap<string, string>,
    path: string,
    root: boolean
): void {
    const expectedType = source.kind === "container" || source.kind === "dynamic-text"
        ? "Sprite"
        : source.kind === "image" ? "Image" : "Text";
    if (value._$type !== expectedType)
        fail("AUTHORED_CONTENT_NATIVE_NODE_TYPE_MISMATCH", `${path} expected ${expectedType}; received ${String(value._$type)}.`);
    const expectedName = source.name ?? source.linkage;
    if (value.name !== expectedName)
        fail("AUTHORED_CONTENT_NATIVE_INSTANCE_NAME_MISMATCH", `${path} expected instance '${expectedName}'.`);
    validateEffectiveNodeField(source, value, path, "x", 0);
    validateEffectiveNodeField(source, value, path, "y", 0);
    validateEffectiveNodeField(source, value, path, "width", 0);
    validateEffectiveNodeField(source, value, path, "height", 0);
    validateEffectiveNodeField(source, value, path, "alpha", 1);
    validateEffectiveNodeField(source, value, path, "visible", true);
    if (!root) {
        if (value.zOrder !== undefined && value.zOrder !== source.depth)
            fail("AUTHORED_CONTENT_NATIVE_DEPTH_MISMATCH", `${path} expected zOrder ${source.depth}; received ${String(value.zOrder)}.`);
        // LayaAir IDE 3.4's HierarchyWriter omits zOrder even when authored.
        // Restore the already-normalized depth explicitly at the .lh boundary.
        value.zOrder = source.depth;
    }
    if (source.kind === "image") {
        const expectedSkin = `res://${resourceAssetIds.get(source.resourceId!)}`;
        if (value.skin !== expectedSkin)
            fail("AUTHORED_CONTENT_NATIVE_IMAGE_BINDING_MISMATCH", `${path} expected skin '${expectedSkin}'.`);
    }
    const childrenValue = value._$child;
    const children = childrenValue === undefined ? [] : childrenValue;
    if (!Array.isArray(children) || children.length !== source.children.length)
        fail("AUTHORED_CONTENT_NATIVE_CHILD_CLOSURE_MISMATCH", `${path} child count/order closure drifted.`);
    source.children.forEach((child, index) => {
        const childValue = children[index];
        if (!childValue || typeof childValue !== "object" || Array.isArray(childValue))
            fail("AUTHORED_CONTENT_NATIVE_CHILD_INVALID", `${path}._$child[${index}] is not a hierarchy node.`);
        validateHierarchyNode(child, childValue as Record<string, unknown>, resourceAssetIds, `${path}/${child.name ?? child.linkage}`, false);
    });
}

function decorateAuthoredRuntime(
    source: NeutralAuthoredNode,
    value: Record<string, unknown>,
): void {
    if (source.variable === true)
        value._$var = true;
    if (source.filters !== undefined)
        value.authoredFilters = source.filters;
    if (source.scale9Grid !== undefined)
        value.authoredScale9Grid = source.scale9Grid;
    if (source.kind === "dynamic-text") {
        value._$type = "Sprite";
        value._$runtime = AUTHORED_CONTENT_RUNTIME_IDS.textField;
        value.authoredConfiguration = {
            sourceId: source.textField!.sourceId,
            x: source.x!,
            y: source.y!,
            width: source.width!,
            height: source.height!,
            type: source.textField!.type,
            multiline: source.textField!.multiline,
            wordWrap: source.textField!.wordWrap,
            selectable: source.textField!.selectable,
            displayAsPassword: source.textField!.displayAsPassword,
            autoSize: source.textField!.autoSize,
            html: source.textField!.html,
            // ObjDecoder treats untyped objects inside arrays as class payloads.
            // The sealed `any` envelope preserves exact inert filter data until
            // AuthoredTextField validates and constructs the native GlowFilter.
            filters: source.textField!.filters.map(filter => ({ _$type: "any", value: filter })),
            gutter: source.textField!.gutter,
            overflow: source.textField!.overflow,
            initialText: source.textField!.initialText,
            format: source.textField!.format,
        };
    }
    else if (source.kind === "container" && source.timeline !== undefined) {
        value._$type = "Sprite";
        value._$runtime = AUTHORED_CONTENT_RUNTIME_IDS.movieClip;
    }
    if (source.runtimeLinkage !== undefined) {
        value._$type = "Sprite";
        value._$runtime = source.runtimeLinkage;
    }
    const children = value._$child;
    if (!Array.isArray(children) || children.length !== source.children.length)
        return;
    source.children.forEach((child, index) => {
        const target = children[index];
        if (target && typeof target === "object" && !Array.isArray(target))
            decorateAuthoredRuntime(child, target as Record<string, unknown>);
    });
}

function hashBytes(value: Uint8Array): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function aggregateFailure(message: string, errors: ReadonlyArray<unknown>): Error & { readonly errors: ReadonlyArray<unknown> } {
    return Object.assign(new Error(message), { errors: Object.freeze([...errors]) });
}

interface SealedBundleFileAuthority {
    readonly path: string;
    readonly byteLength: number;
    readonly sha256: string;
}

const sealedBundleAuthorities = new WeakMap<NativeAuthoredContentBundle, ReadonlyArray<SealedBundleFileAuthority>>();

type AuthenticatedNodeField = "x" | "y" | "width" | "height" | "alpha" | "visible";

function validateEffectiveNodeField(
    source: NeutralAuthoredNode,
    value: Record<string, unknown>,
    path: string,
    field: AuthenticatedNodeField,
    nativeDefault: number | boolean
): void {
    const expected = source[field] ?? nativeDefault;
    const received = value[field] === undefined ? nativeDefault : value[field];
    if (received === expected)
        return;
    if (typeof expected === "number" && typeof received === "number"
        && field !== "alpha" && received === Math.round(expected)) {
        value[field] = expected;
        return;
    }
    fail(
        `AUTHORED_CONTENT_NATIVE_${field.toUpperCase()}_MISMATCH`,
        `${path} expected ${field} ${String(expected)}; received ${String(received)}.`
    );
}

function assertExactKeys<T>(map: ReadonlyMap<string, T>, expected: ReadonlyArray<string>, label: string): void {
    if (!(map instanceof Map) || map.size !== expected.length)
        fail(`AUTHORED_CONTENT_NATIVE_${label}_CLOSURE`, `${label.toLowerCase()} closure size drifted.`);
    const expectedSet = new Set(expected);
    for (const id of expected) {
        if (!map.has(id))
            fail(`AUTHORED_CONTENT_NATIVE_${label}_MISSING`, `Missing ${label.toLowerCase()} '${id}'.`);
    }
    for (const id of map.keys()) {
        if (!expectedSet.has(id))
            fail(`AUTHORED_CONTENT_NATIVE_${label}_UNKNOWN`, `Unknown ${label.toLowerCase()} '${id}'.`);
    }
}

function normalizeNestedTimelinePublications(
    root: NeutralAuthoredNode,
    publications: ReadonlyArray<NativeNestedTimelinePublication>
): ReadonlyArray<NativeNestedTimelinePublication> {
    const expected: string[] = [];
    const visit = (node: NeutralAuthoredNode, parent: ReadonlyArray<string>) => {
        const semanticPath = [...parent, node.linkage];
        if (node.timeline !== undefined)
            expected.push(semanticPath.join("/"));
        node.children.forEach(child => visit(child, semanticPath));
    };
    visit(root, []);
    if (!Array.isArray(publications) || publications.length !== expected.length)
        fail("AUTHORED_CONTENT_NATIVE_NESTED_TIMELINE_CLOSURE", "Nested timeline publication closure drifted.");
    const byPath = new Map(publications.map(value => [value.semanticPath, value]));
    if (byPath.size !== publications.length)
        fail("AUTHORED_CONTENT_NATIVE_NESTED_TIMELINE_DUPLICATE", "A nested timeline semantic path is duplicated.");
    const normalized = expected.map(semanticPath => {
        const value = byPath.get(semanticPath);
        if (!value)
            fail("AUTHORED_CONTENT_NATIVE_NESTED_TIMELINE_MISSING", `Missing nested timeline '${semanticPath}'.`);
        const timelinePath = canonicalOutputPath(value.timelinePath, ".mc", `nested timeline ${semanticPath}`);
        if (typeof value.timelineAssetId !== "string" || value.timelineAssetId.length === 0
            || value.timelineAssetId.indexOf("\0") >= 0)
            fail("AUTHORED_CONTENT_NATIVE_NESTED_TIMELINE_ID_REQUIRED", `Nested timeline '${semanticPath}' has no stable asset ID.`);
        if (!(value.timelineBytes instanceof Uint8Array) || value.timelineBytes.byteLength === 0)
            fail("AUTHORED_CONTENT_NATIVE_NESTED_TIMELINE_BYTES_REQUIRED", `Nested timeline '${semanticPath}' has no native .mc bytes.`);
        return { ...value, timelinePath };
    });
    if (new Set(normalized.map(value => value.timelineAssetId)).size !== normalized.length)
        fail("AUTHORED_CONTENT_NATIVE_NESTED_TIMELINE_ID_COLLISION", "Nested timeline asset IDs collide.");
    return normalized;
}

function canonicalOutputPath(value: string, extension: string, label: string): string {
    if (typeof value !== "string" || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)
        || value.split("/").some(segment => segment === "" || segment === "." || segment === "..")
        || !value.toLocaleLowerCase("en-US").endsWith(extension))
        fail("AUTHORED_CONTENT_NATIVE_OUTPUT_PATH_INVALID", `${label} must be a normalized relative ${extension} path.`);
    return value.normalize("NFC");
}

function canonicalJsonBytes(value: unknown): Uint8Array {
    const canonical = canonicalClone(value, "hierarchy");
    return new TextEncoder().encode(`${JSON.stringify(canonical, null, 2)}\n`);
}

function canonicalClone(value: unknown, path: string, seen = new Set<object>()): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            fail("AUTHORED_CONTENT_NATIVE_JSON_NUMBER_INVALID", `${path} is not finite.`);
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) {
        if (seen.has(value))
            fail("AUTHORED_CONTENT_NATIVE_JSON_CYCLE", `${path} is cyclic.`);
        seen.add(value);
        const result = value.map((child, index) => {
            if (child === undefined)
                fail("AUTHORED_CONTENT_NATIVE_JSON_UNDEFINED", `${path}[${index}] is undefined.`);
            return canonicalClone(child, `${path}[${index}]`, seen);
        });
        seen.delete(value);
        return result;
    }
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        fail("AUTHORED_CONTENT_NATIVE_JSON_VALUE_UNSUPPORTED", `${path} is not a plain JSON value.`);
    if (seen.has(value as object))
        fail("AUTHORED_CONTENT_NATIVE_JSON_CYCLE", `${path} is cyclic.`);
    seen.add(value as object);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
        const child = (value as Record<string, unknown>)[key];
        if (child !== undefined)
            result[key] = canonicalClone(child, `${path}.${key}`, seen);
    }
    seen.delete(value as object);
    return result;
}

function cloneBytes(value: Uint8Array): Uint8Array {
    return new Uint8Array(value);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string, message: string): never {
    throw new Error(`${code}: ${message}`);
}
