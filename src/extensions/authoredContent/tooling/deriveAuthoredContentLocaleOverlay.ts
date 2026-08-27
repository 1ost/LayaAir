import { AuthoredContentToolError } from "./types.js";

export const AUTHORED_CONTENT_LOCALE_SCHEMA = "laya-authored-content-locale@1" as const;
const NEUTRAL_AUTHORED_CONTENT_SCHEMA = "neutral-authored-content@1" as const;

export interface AuthoredContentLocaleImageBinding {
    /** Resource identity in both normalized neutral IR documents. */
    readonly resourceId: string;
    /** Existing image asset identity in the locale-neutral runtime catalog. */
    readonly assetId: string;
    /** Published locale-relative path for the localized image bytes. */
    readonly path: string;
}

export interface AuthoredContentLocaleBundleComparison {
    /** Existing bundle identity in the locale-neutral runtime catalog. */
    readonly bundle: string;
    /** Normalized neutral IR produced from the locale-neutral evidence. */
    readonly base: unknown;
    /** Normalized neutral IR produced from the locale-specific evidence. */
    readonly localized: unknown;
    /** Explicit catalog/path authority for image resources whose bytes differ. */
    readonly imageBindings?: readonly AuthoredContentLocaleImageBinding[];
}

export interface DeriveAuthoredContentLocaleOverlayRequest {
    readonly id: string;
    readonly locale: string;
    readonly baseCatalog: string;
    /** Strict structural comparison by default; text-map-only authenticates only TextField target correspondence. */
    readonly mode?: "strict" | "text-map-only";
    readonly bundles: readonly AuthoredContentLocaleBundleComparison[];
}

export interface AuthoredContentLocaleAssetOverride {
    readonly id: string;
    readonly path: string;
}

export interface AuthoredContentLocaleTranslation {
    readonly bundle: string;
    readonly target: string;
    readonly text: string;
}

export interface DerivedAuthoredContentLocaleOverlay {
    readonly schema: typeof AUTHORED_CONTENT_LOCALE_SCHEMA;
    readonly id: string;
    readonly locale: string;
    readonly baseCatalog: string;
    readonly assetOverrides: readonly AuthoredContentLocaleAssetOverride[];
    readonly translations: readonly AuthoredContentLocaleTranslation[];
}

/**
 * Derives the narrow runtime locale overlay from two already-normalized IR
 * projections. Only dynamic/input initial text and authenticated image bytes
 * may differ. Every structural, timeline, font, and static-text difference
 * fails closed and therefore requires a full locale catalog (or a baked image
 * selected through an explicit image binding).
 */
export function deriveAuthoredContentLocaleOverlay(
    request: DeriveAuthoredContentLocaleOverlayRequest,
): DerivedAuthoredContentLocaleOverlay {
    const source = plainRecord(request, "request");
    exactKeys(source, ["id", "locale", "baseCatalog", "mode", "bundles"], "request", ["mode"]);
    const id = stableText(source.id, "request.id");
    const locale = localeSegment(source.locale, "request.locale");
    const baseCatalog = catalogReference(source.baseCatalog, "request.baseCatalog");
    const mode = derivationMode(source.mode, "request.mode");
    if (!Array.isArray(source.bundles)) fail("AUTHORED_CONTENT_LOCALE_BUNDLES", "request.bundles must be an array.");

    const translations: AuthoredContentLocaleTranslation[] = [];
    const assetOverrides: AuthoredContentLocaleAssetOverride[] = [];
    const bundleIds = new Set<string>();
    const translationIds = new Set<string>();
    const assetIds = new Set<string>();

    for (const [index, value] of source.bundles.entries()) {
        const path = `request.bundles[${index}]`;
        const comparison = plainRecord(value, path);
        exactKeys(comparison, ["bundle", "base", "localized", "imageBindings"], path, ["imageBindings"]);
        const bundle = unique(stableText(comparison.bundle, `${path}.bundle`), bundleIds, "AUTHORED_CONTENT_LOCALE_BUNDLE_DUPLICATE", "bundle");
        const base = neutralDocument(comparison.base, `${path}.base`);
        const localized = neutralDocument(comparison.localized, `${path}.localized`);
        const imageBindings = normalizeImageBindings(comparison.imageBindings, `${path}.imageBindings`);

        if (mode === "text-map-only") {
            if (imageBindings.size !== 0)
                fail("AUTHORED_CONTENT_LOCALE_MAP_ONLY_IMAGE_BINDINGS", `${path}.imageBindings is not admitted by text-map-only derivation.`);
            compareTextMapOnly(base.root, localized.root, bundle, path, translations, translationIds);
        }
        else {
            compareTopLevel(base, localized, path);
            compareResources(base.resources, localized.resources, imageBindings, path, assetOverrides, assetIds);
            compareNode(base.root, localized.root, bundle, "$", path, translations, translationIds);
        }
        for (const resourceId of imageBindings.keys()) {
            if (!imageBindings.get(resourceId)!.consumed)
                fail("AUTHORED_CONTENT_LOCALE_IMAGE_BINDING_UNUSED", `${path}.imageBindings contains unchanged or unknown resource '${resourceId}'.`);
        }
    }

    translations.sort((left, right) => compareText(left.bundle, right.bundle) || compareText(left.target, right.target));
    assetOverrides.sort((left, right) => compareText(left.id, right.id));
    return Object.freeze({
        schema: AUTHORED_CONTENT_LOCALE_SCHEMA,
        id,
        locale,
        baseCatalog,
        assetOverrides: Object.freeze(assetOverrides.map(value => Object.freeze(value))),
        translations: Object.freeze(translations.map(value => Object.freeze(value))),
    });
}

interface LocaleTextTarget {
    readonly target: string;
    readonly text: string;
}

/**
 * Derives a text-only map against the locale-neutral runtime tree. Localized
 * media, font, stage, timeline, and non-text node deltas are deliberately out
 * of scope. Generated Flash character ids are not stable across localized SWF
 * exports, so only `character_<digits>` path segments are normalized; every
 * resulting TextField target must still have an unambiguous one-to-one match.
 */
function compareTextMapOnly(
    baseRoot: JsonRecord,
    localizedRoot: JsonRecord,
    bundle: string,
    path: string,
    translations: AuthoredContentLocaleTranslation[],
    translationIds: Set<string>,
): void {
    const base = collectLocaleTextTargets(baseRoot, `${path}.base.root`);
    const localized = collectLocaleTextTargets(localizedRoot, `${path}.localized.root`);
    const baseKeys = [...base.keys()].sort(compareText);
    const localizedKeys = [...localized.keys()].sort(compareText);
    const missing = baseKeys.filter(key => !localized.has(key));
    const extra = localizedKeys.filter(key => !base.has(key));
    if (missing.length || extra.length)
        fail("AUTHORED_CONTENT_LOCALE_TEXT_TARGET_SET_DIFFERENCE", `${path} text targets do not correspond (missing localized: ${missing.join(", ") || "none"}; extra localized: ${extra.join(", ") || "none"}).`);
    for (const key of baseKeys) {
        const baseTarget = base.get(key)!;
        const localizedTarget = localized.get(key)!;
        if (baseTarget.text === localizedTarget.text) continue;
        const identity = `${bundle}\n${baseTarget.target}`;
        if (translationIds.has(identity))
            fail("AUTHORED_CONTENT_LOCALE_TRANSLATION_DUPLICATE", `Translation target '${bundle}/${baseTarget.target}' is ambiguous.`);
        translationIds.add(identity);
        translations.push({ bundle, target: baseTarget.target, text: localizedTarget.text });
    }
}

function collectLocaleTextTargets(root: JsonRecord, path: string): Map<string, LocaleTextTarget> {
    const result = new Map<string, LocaleTextTarget>();
    visitLocaleTextTargets(root, "$", "$", path, result);
    return result;
}

function visitLocaleTextTargets(
    node: JsonRecord,
    target: string,
    canonicalTarget: string,
    path: string,
    result: Map<string, LocaleTextTarget>,
): void {
    if (node.textField !== undefined) {
        const textField = plainRecord(node.textField, `${path}.textField`);
        if (typeof textField.initialText !== "string")
            fail("AUTHORED_CONTENT_LOCALE_INITIAL_TEXT", `${path}.textField.initialText must be a string.`);
        if (result.has(canonicalTarget))
            fail("AUTHORED_CONTENT_LOCALE_TEXT_TARGET_AMBIGUOUS", `${path} duplicates canonical text target '${canonicalTarget}'.`);
        result.set(canonicalTarget, { target, text: textField.initialText });
    }
    if (!Array.isArray(node.children))
        fail("AUTHORED_CONTENT_LOCALE_NODE_CHILDREN", `${path}.children must be an array.`);
    for (const [index, value] of node.children.entries()) {
        const childPath = `${path}.children[${index}]`;
        const child = plainRecord(value, childPath);
        const segment = nodeSegment(child, childPath);
        const canonicalSegment = /^character_\d+$/.test(segment) ? "character_*" : segment;
        visitLocaleTextTargets(
            child,
            target === "$" ? segment : `${target}/${segment}`,
            canonicalTarget === "$" ? canonicalSegment : `${canonicalTarget}/${canonicalSegment}`,
            childPath,
            result,
        );
    }
}

type JsonRecord = Record<string, unknown>;
type ImageBindingState = AuthoredContentLocaleImageBinding & { consumed: boolean };

function neutralDocument(value: unknown, path: string): JsonRecord & { resources: unknown[]; root: JsonRecord } {
    const source = plainRecord(value, path);
    exactKeys(source, ["schema", "documentId", "resources", "root", "timeline", "stage", "inertPlacementRatios"], path, ["stage", "inertPlacementRatios"]);
    if (source.schema !== NEUTRAL_AUTHORED_CONTENT_SCHEMA)
        fail("AUTHORED_CONTENT_LOCALE_IR_SCHEMA", `${path}.schema must equal '${NEUTRAL_AUTHORED_CONTENT_SCHEMA}'.`);
    stableText(source.documentId, `${path}.documentId`);
    if (!Array.isArray(source.resources)) fail("AUTHORED_CONTENT_LOCALE_IR_RESOURCES", `${path}.resources must be an array.`);
    const root = plainRecord(source.root, `${path}.root`);
    return source as JsonRecord & { resources: unknown[]; root: JsonRecord };
}

function compareTopLevel(base: JsonRecord, localized: JsonRecord, path: string): void {
    for (const key of ["schema", "documentId", "timeline", "stage", "inertPlacementRatios"] as const) {
        if (!deepEqual(base[key], localized[key]))
            fail("AUTHORED_CONTENT_LOCALE_STRUCTURAL_DIFFERENCE", `${path}.${key} differs; emit a full locale catalog.`);
    }
}

function normalizeImageBindings(value: unknown, path: string): Map<string, ImageBindingState> {
    if (value === undefined) return new Map();
    if (!Array.isArray(value)) fail("AUTHORED_CONTENT_LOCALE_IMAGE_BINDINGS", `${path} must be an array.`);
    const result = new Map<string, ImageBindingState>();
    for (const [index, entry] of value.entries()) {
        const itemPath = `${path}[${index}]`;
        const source = plainRecord(entry, itemPath);
        exactKeys(source, ["resourceId", "assetId", "path"], itemPath);
        const resourceId = stableText(source.resourceId, `${itemPath}.resourceId`);
        if (result.has(resourceId)) fail("AUTHORED_CONTENT_LOCALE_IMAGE_BINDING_DUPLICATE", `${itemPath}.resourceId duplicates '${resourceId}'.`);
        result.set(resourceId, {
            resourceId,
            assetId: stableText(source.assetId, `${itemPath}.assetId`),
            path: relativePath(source.path, `${itemPath}.path`),
            consumed: false,
        });
    }
    return result;
}

function compareResources(
    baseValue: unknown[],
    localizedValue: unknown[],
    bindings: Map<string, ImageBindingState>,
    path: string,
    overrides: AuthoredContentLocaleAssetOverride[],
    assetIds: Set<string>,
): void {
    const base = resourceMap(baseValue, `${path}.base.resources`);
    const localized = resourceMap(localizedValue, `${path}.localized.resources`);
    if (!deepEqual([...base.keys()].sort(compareText), [...localized.keys()].sort(compareText)))
        fail("AUTHORED_CONTENT_LOCALE_RESOURCE_SET_DIFFERENCE", `${path} resource identities differ; emit a full locale catalog.`);
    for (const [resourceId, baseResource] of base) {
        const localizedResource = localized.get(resourceId)!;
        const mediaType = stableText(baseResource.mediaType, `${path}.base.resources.${resourceId}.mediaType`);
        if (localizedResource.mediaType !== mediaType)
            fail("AUTHORED_CONTENT_LOCALE_RESOURCE_KIND_DIFFERENCE", `${path} resource '${resourceId}' changes media type; emit a full locale catalog.`);
        const mutable = mediaType === "image/png" || mediaType === "image/jpeg"
            ? new Set(["sourcePath", "outputPath", "byteLength", "sha256"])
            : new Set<string>();
        if (!equalExcept(baseResource, localizedResource, mutable))
            fail("AUTHORED_CONTENT_LOCALE_RESOURCE_STRUCTURAL_DIFFERENCE", `${path} resource '${resourceId}' differs outside localized image bytes; emit a full locale catalog.`);
        const bytesDiffer = baseResource.sha256 !== localizedResource.sha256 || baseResource.byteLength !== localizedResource.byteLength;
        if (!bytesDiffer) continue;
        if (mutable.size === 0)
            fail("AUTHORED_CONTENT_LOCALE_NON_IMAGE_DIFFERENCE", `${path} non-image resource '${resourceId}' differs; emit a full locale catalog.`);
        const binding = bindings.get(resourceId);
        if (!binding)
            fail("AUTHORED_CONTENT_LOCALE_IMAGE_BINDING_REQUIRED", `${path} changed image resource '${resourceId}' requires an explicit base-catalog asset id and localized path.`);
        binding.consumed = true;
        if (assetIds.has(binding.assetId))
            fail("AUTHORED_CONTENT_LOCALE_ASSET_OVERRIDE_DUPLICATE", `Locale asset id '${binding.assetId}' is bound more than once.`);
        assetIds.add(binding.assetId);
        overrides.push({ id: binding.assetId, path: binding.path });
    }
}

function resourceMap(resources: unknown[], path: string): Map<string, JsonRecord> {
    const result = new Map<string, JsonRecord>();
    for (const [index, value] of resources.entries()) {
        const resource = plainRecord(value, `${path}[${index}]`);
        const id = stableText(resource.id, `${path}[${index}].id`);
        if (result.has(id)) fail("AUTHORED_CONTENT_LOCALE_RESOURCE_DUPLICATE", `${path}[${index}].id duplicates '${id}'.`);
        result.set(id, resource);
    }
    return result;
}

function compareNode(
    base: JsonRecord,
    localized: JsonRecord,
    bundle: string,
    target: string,
    path: string,
    translations: AuthoredContentLocaleTranslation[],
    translationIds: Set<string>,
): void {
    const baseChildren = base.children;
    const localizedChildren = localized.children;
    if (!Array.isArray(baseChildren) || !Array.isArray(localizedChildren))
        fail("AUTHORED_CONTENT_LOCALE_NODE_CHILDREN", `${path} nodes must contain children arrays.`);
    if (baseChildren.length !== localizedChildren.length)
        fail("AUTHORED_CONTENT_LOCALE_STRUCTURAL_DIFFERENCE", `${path} child count differs; emit a full locale catalog.`);

    if (base.text !== localized.text)
        fail("AUTHORED_CONTENT_LOCALE_STATIC_TEXT_DIFFERENCE", `${path} static text differs at '${target}'; translations only target TextField, so bake an image override or emit a full locale catalog.`);

    compareNodeFields(base, localized, new Set(["children", "textField", "text"]), path);
    compareTextField(base.textField, localized.textField, bundle, target, path, translations, translationIds);

    for (let index = 0; index < baseChildren.length; index++) {
        const childPath = `${path}.children[${index}]`;
        const baseChild = plainRecord(baseChildren[index], `${childPath}.base`);
        const localizedChild = plainRecord(localizedChildren[index], `${childPath}.localized`);
        const segment = nodeSegment(baseChild, `${childPath}.base`);
        compareNode(baseChild, localizedChild, bundle, target === "$" ? segment : `${target}/${segment}`, childPath, translations, translationIds);
    }
}

function compareTextField(
    baseValue: unknown,
    localizedValue: unknown,
    bundle: string,
    target: string,
    path: string,
    translations: AuthoredContentLocaleTranslation[],
    translationIds: Set<string>,
): void {
    if (baseValue === undefined && localizedValue === undefined) return;
    const base = plainRecord(baseValue, `${path}.base.textField`);
    const localized = plainRecord(localizedValue, `${path}.localized.textField`);
    compareNodeFields(base, localized, new Set(["initialText"]), `${path}.textField`);
    if (typeof base.initialText !== "string" || typeof localized.initialText !== "string")
        fail("AUTHORED_CONTENT_LOCALE_INITIAL_TEXT", `${path}.textField.initialText must be a string in both projections.`);
    if (base.initialText === localized.initialText) return;
    const identity = `${bundle}\n${target}`;
    if (translationIds.has(identity))
        fail("AUTHORED_CONTENT_LOCALE_TRANSLATION_DUPLICATE", `Translation target '${bundle}/${target}' is ambiguous.`);
    translationIds.add(identity);
    translations.push({ bundle, target, text: localized.initialText });
}

function compareNodeFields(base: JsonRecord, localized: JsonRecord, ignored: Set<string>, path: string): void {
    const keys = new Set([...Object.keys(base), ...Object.keys(localized)]);
    for (const key of keys) {
        if (ignored.has(key)) continue;
        if (!deepEqual(base[key], localized[key]))
            fail("AUTHORED_CONTENT_LOCALE_STRUCTURAL_DIFFERENCE", `${path}.${key} differs; emit a full locale catalog.`);
    }
}

function nodeSegment(node: JsonRecord, path: string): string {
    const value = node.name ?? node.instanceId ?? node.linkage;
    const segment = stableText(value, `${path}.name`);
    if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"))
        fail("AUTHORED_CONTENT_LOCALE_TARGET_INVALID", `${path} does not have a normalized runtime instance name.`);
    return segment;
}

function equalExcept(left: JsonRecord, right: JsonRecord, ignored: Set<string>): boolean {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) if (!ignored.has(key) && !deepEqual(left[key], right[key])) return false;
    return true;
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right))
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    const leftRecord = left as JsonRecord;
    const rightRecord = right as JsonRecord;
    const leftKeys = Object.keys(leftRecord).sort(compareText);
    const rightKeys = Object.keys(rightRecord).sort(compareText);
    return deepEqual(leftKeys, rightKeys) && leftKeys.every(key => deepEqual(leftRecord[key], rightRecord[key]));
}

function plainRecord(value: unknown, path: string): JsonRecord {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("AUTHORED_CONTENT_LOCALE_OBJECT_REQUIRED", `${path} must be an object.`);
    return value as JsonRecord;
}

function exactKeys(source: JsonRecord, required: readonly string[], path: string, optional: readonly string[] = []): void {
    const admitted = new Set(required);
    const missing = required.filter(key => !(key in source) && !optional.includes(key));
    const extra = Object.keys(source).filter(key => !admitted.has(key)).sort(compareText);
    if (missing.length || extra.length)
        fail("AUTHORED_CONTENT_LOCALE_KEYS", `${path} has invalid keys (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}).`);
}

function stableText(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\0"))
        fail("AUTHORED_CONTENT_LOCALE_STRING", `${path} must be a stable non-empty string.`);
    return value.normalize("NFC");
}

function localeSegment(value: unknown, path: string): string {
    const locale = stableText(value, path);
    if (!/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(locale))
        fail("AUTHORED_CONTENT_LOCALE_SEGMENT", `${path} must be one normalized locale segment.`);
    return locale;
}

function derivationMode(value: unknown, path: string): "strict" | "text-map-only" {
    if (value === undefined || value === "strict") return "strict";
    if (value === "text-map-only") return value;
    fail("AUTHORED_CONTENT_LOCALE_MODE", `${path} must equal 'strict' or 'text-map-only'.`);
}

function catalogReference(value: unknown, path: string): string {
    const text = stableText(value, path);
    if (text.includes("\\") || text.includes("?") || text.includes("#")
        || text.split("/").some((part, index) => index > 0 && (part.length === 0 || part === "." || part === ".."))
        || !text.toLowerCase().endsWith(".runtime-catalog.json"))
        fail("AUTHORED_CONTENT_LOCALE_CATALOG_REFERENCE", `${path} must be a normalized runtime-catalog URL without query or fragment.`);
    return text;
}

function relativePath(value: unknown, path: string): string {
    const text = stableText(value, path);
    if (text.includes("\\") || text.includes(":") || text.startsWith("/")
        || text.split("/").some(part => part.length === 0 || part === "." || part === ".."))
        fail("AUTHORED_CONTENT_LOCALE_PATH", `${path} must be a normalized relative POSIX path.`);
    return text;
}

function unique(value: string, seen: Set<string>, code: string, label: string): string {
    if (seen.has(value)) fail(code, `Duplicate ${label} '${value}'.`);
    seen.add(value);
    return value;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string, message: string): never {
    throw new AuthoredContentToolError(code, message);
}
