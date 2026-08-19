import {
    NeutralAuthoredContentIR,
    NeutralAuthoredNode
} from "../core/NeutralAuthoredContentIR";
import { NativeLayaEmitter } from "./NativeLayaEmitter";

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
    readonly resourceAssetIds: ReadonlyMap<string, string>;
    readonly resourcePayloads: ReadonlyMap<string, Uint8Array>;
    readonly sha256: (bytes: Uint8Array) => string | Promise<string>;
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

    assertExactKeys(resourceAssetIds, content.resources.map(resource => resource.id), "RESOURCE_BINDING");
    assertExactKeys(resourcePayloads, content.resources.map(resource => resource.id), "RESOURCE_PAYLOAD");
    const hierarchy = prepareNativeLayaHierarchy(
        content,
        preparation.hierarchy,
        timelineAssetId,
        resourceAssetIds
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
    return Object.freeze({
        schema: "laya-native-authored-content-bundle@1" as const,
        files: Object.freeze(files.map(file => Object.freeze(file)))
    });
}

/** Stages every byte before commit and always rolls back an incomplete transaction. */
export async function writeNativeLayaAuthoredContentTransaction(
    bundle: NativeAuthoredContentBundle,
    transaction: NativeAuthoredContentTransaction
): Promise<void> {
    if (!transaction || typeof transaction.stage !== "function"
        || typeof transaction.commit !== "function" || typeof transaction.rollback !== "function")
        fail("AUTHORED_CONTENT_NATIVE_TRANSACTION_REQUIRED", "A complete transactional output host is required.");
    let committed = false;
    try {
        for (const file of bundle.files)
            await transaction.stage(file.path, cloneBytes(file.bytes));
        await transaction.commit();
        committed = true;
    }
    catch (error) {
        if (!committed) {
            try {
                await transaction.rollback();
            }
            catch {
                // Preserve the original staging/commit failure as the authority.
            }
        }
        throw error;
    }
}

export function prepareNativeLayaHierarchy(
    content: NeutralAuthoredContentIR,
    hierarchyValue: Record<string, unknown>,
    timelineAssetId: string,
    resourceAssetIds: ReadonlyMap<string, string>
): Record<string, unknown> {
    const hierarchy = canonicalClone(hierarchyValue, "hierarchy") as Record<string, unknown>;
    if (hierarchy._$ver !== 1)
        fail("AUTHORED_CONTENT_NATIVE_HIERARCHY_VERSION", "HierarchyWriter must emit Laya hierarchy version 1.");
    validateHierarchyNode(content.root, hierarchy, resourceAssetIds, "root", true);
    hierarchy._$authoredContent = NativeLayaEmitter.createMetadataWithResourceBindings(
        content,
        timelineAssetId,
        resourceAssetIds
    );
    hierarchy._$preloads = [
        ...content.resources.map(resource => resourceAssetIds.get(resource.id)!),
        timelineAssetId
    ];
    hierarchy._$preloadTypes = [
        ...content.resources.map(() => "Texture2D"),
        "AnimationClip2D"
    ];
    return hierarchy;
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
    const expectedType = source.kind === "container" ? "Sprite" : source.kind === "image" ? "Image" : "Text";
    if (value._$type !== expectedType)
        fail("AUTHORED_CONTENT_NATIVE_NODE_TYPE_MISMATCH", `${path} expected ${expectedType}; received ${String(value._$type)}.`);
    const expectedName = source.name ?? source.linkage;
    if (value.name !== expectedName)
        fail("AUTHORED_CONTENT_NATIVE_INSTANCE_NAME_MISMATCH", `${path} expected instance '${expectedName}'.`);
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
