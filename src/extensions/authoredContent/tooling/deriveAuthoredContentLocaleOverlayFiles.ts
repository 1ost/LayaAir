import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
    deriveAuthoredContentLocaleOverlay,
    type AuthoredContentLocaleBundleComparison,
    type DerivedAuthoredContentLocaleOverlay,
} from "./deriveAuthoredContentLocaleOverlay.js";
import { canonicalJson, readStrictJson, sha256 } from "./project/CanonicalJson.js";
import { AuthoredContentToolError } from "./types.js";

export const AUTHORED_CONTENT_LOCALE_DIFF_REQUEST_SCHEMA = "laya-authored-content-locale-diff-request@1" as const;
export const AUTHORED_CONTENT_LOCALE_DIFF_RESULT_SCHEMA = "laya-authored-content-locale-diff-result@1" as const;

export interface DeriveAuthoredContentLocaleOverlayFilesRequest {
    readonly requestPath: string;
    readonly outputPath: string;
    readonly check: boolean;
}

export interface DeriveAuthoredContentLocaleOverlayFilesResult {
    readonly schema: typeof AUTHORED_CONTENT_LOCALE_DIFF_RESULT_SCHEMA;
    readonly status: "written" | "unchanged";
    readonly outputSha256: string;
    readonly overlay: DerivedAuthoredContentLocaleOverlay;
}

interface LocaleDiffBundleDocument {
    readonly bundle: string;
    readonly base: string;
    readonly localized: string;
    readonly baseRuntimeHierarchy?: string;
    readonly imageBindings?: AuthoredContentLocaleBundleComparison["imageBindings"];
}

interface LocaleDiffDocument {
    readonly schema: typeof AUTHORED_CONTENT_LOCALE_DIFF_REQUEST_SCHEMA;
    readonly id: string;
    readonly locale: string;
    readonly baseCatalog: string;
    readonly mode?: "strict" | "text-map-only";
    readonly bundles: readonly LocaleDiffBundleDocument[];
}

export async function deriveAuthoredContentLocaleOverlayFiles(
    request: DeriveAuthoredContentLocaleOverlayFilesRequest,
): Promise<DeriveAuthoredContentLocaleOverlayFilesResult> {
    const requestPath = absoluteFilePath(request.requestPath, "requestPath");
    const outputPath = absoluteFilePath(request.outputPath, "outputPath");
    if (samePath(requestPath, outputPath))
        fail("AUTHORED_CONTENT_LOCALE_OUTPUT_ALIAS", "Locale output must not replace its diff request.");
    if (typeof request.check !== "boolean")
        fail("AUTHORED_CONTENT_LOCALE_CHECK", "check must be boolean.");

    await requireRegularFile(requestPath, "locale diff request");
    const requestRoot = await realpath(path.dirname(requestPath));
    const document = validateLocaleDiffDocument(await readStrictJson(requestPath, "locale diff request"));
    const comparisons: AuthoredContentLocaleBundleComparison[] = [];
    for (const [index, bundle] of document.bundles.entries()) {
        const basePath = await resolveInput(requestRoot, bundle.base, `bundles[${index}].base`);
        const localizedPath = await resolveInput(requestRoot, bundle.localized, `bundles[${index}].localized`);
        const baseRuntimeHierarchyPath = bundle.baseRuntimeHierarchy === undefined
            ? undefined
            : await resolveInput(requestRoot, bundle.baseRuntimeHierarchy, `bundles[${index}].baseRuntimeHierarchy`);
        for (const input of [basePath, localizedPath, baseRuntimeHierarchyPath]) {
            if (input === undefined) continue;
            if (samePath(input, outputPath))
                fail("AUTHORED_CONTENT_LOCALE_OUTPUT_ALIAS", "Locale output must not replace a neutral IR input.");
        }
        comparisons.push({
            bundle: bundle.bundle,
            base: await readStrictJson(basePath, `${bundle.bundle} base neutral IR`),
            localized: await readStrictJson(localizedPath, `${bundle.bundle} localized neutral IR`),
            ...(baseRuntimeHierarchyPath === undefined ? {} : {
                baseRuntimeTargets: runtimeHierarchyTextTargets(
                    await readStrictJson(baseRuntimeHierarchyPath, `${bundle.bundle} base runtime hierarchy`),
                    `${bundle.bundle} base runtime hierarchy`,
                ),
            }),
            ...(bundle.imageBindings === undefined ? {} : { imageBindings: bundle.imageBindings }),
        });
    }

    const overlay = deriveAuthoredContentLocaleOverlay({
        id: document.id,
        locale: document.locale,
        baseCatalog: document.baseCatalog,
        ...(document.mode === undefined ? {} : { mode: document.mode }),
        bundles: comparisons,
    });
    const bytes = Buffer.from(canonicalJson(overlay), "utf8");
    const outputSha256 = sha256(bytes);
    const existing = await readOutput(outputPath);
    if (existing?.equals(bytes))
        return { schema: AUTHORED_CONTENT_LOCALE_DIFF_RESULT_SCHEMA, status: "unchanged", outputSha256, overlay };
    if (request.check)
        fail("AUTHORED_CONTENT_LOCALE_OUTPUT_DRIFT", existing === undefined
            ? "Locale overlay output is missing."
            : "Locale overlay output is not the deterministic canonical rebuild.");
    await atomicReplace(outputPath, bytes);
    return { schema: AUTHORED_CONTENT_LOCALE_DIFF_RESULT_SCHEMA, status: "written", outputSha256, overlay };
}

function validateLocaleDiffDocument(value: unknown): LocaleDiffDocument {
    const source = plainRecord(value, "locale diff request");
    exactKeys(source, ["schema", "id", "locale", "baseCatalog", "mode", "bundles"], "locale diff request", ["mode"]);
    if (source.schema !== AUTHORED_CONTENT_LOCALE_DIFF_REQUEST_SCHEMA)
        fail("AUTHORED_CONTENT_LOCALE_DIFF_SCHEMA", `locale diff request.schema must equal '${AUTHORED_CONTENT_LOCALE_DIFF_REQUEST_SCHEMA}'.`);
    if (!Array.isArray(source.bundles) || source.bundles.length === 0)
        fail("AUTHORED_CONTENT_LOCALE_DIFF_BUNDLES", "locale diff request.bundles must be a non-empty array.");
    const bundles = source.bundles.map((value, index): LocaleDiffBundleDocument => {
        const itemPath = `locale diff request.bundles[${index}]`;
        const bundle = plainRecord(value, itemPath);
        exactKeys(bundle, ["bundle", "base", "localized", "baseRuntimeHierarchy", "imageBindings"], itemPath, ["baseRuntimeHierarchy", "imageBindings"]);
        if (bundle.imageBindings !== undefined && !Array.isArray(bundle.imageBindings))
            fail("AUTHORED_CONTENT_LOCALE_IMAGE_BINDINGS", `${itemPath}.imageBindings must be an array.`);
        return {
            bundle: requiredString(bundle.bundle, `${itemPath}.bundle`),
            base: relativeInputPath(bundle.base, `${itemPath}.base`),
            localized: relativeInputPath(bundle.localized, `${itemPath}.localized`),
            ...(bundle.baseRuntimeHierarchy === undefined ? {} : {
                baseRuntimeHierarchy: relativeInputPath(bundle.baseRuntimeHierarchy, `${itemPath}.baseRuntimeHierarchy`),
            }),
            ...(bundle.imageBindings === undefined ? {} : {
                imageBindings: bundle.imageBindings as unknown as AuthoredContentLocaleBundleComparison["imageBindings"],
            }),
        };
    });
    return {
        schema: AUTHORED_CONTENT_LOCALE_DIFF_REQUEST_SCHEMA,
        id: requiredString(source.id, "locale diff request.id"),
        locale: requiredString(source.locale, "locale diff request.locale"),
        baseCatalog: requiredString(source.baseCatalog, "locale diff request.baseCatalog"),
        ...(source.mode === undefined ? {} : { mode: derivationMode(source.mode, "locale diff request.mode") }),
        bundles,
    };
}

function runtimeHierarchyTextTargets(value: unknown, label: string): readonly string[] {
    const hierarchy = plainRecord(value, label);
    const authored = plainRecord(hierarchy._$authoredContent, `${label}._$authoredContent`);
    if (!Array.isArray(authored.nodes))
        fail("AUTHORED_CONTENT_LOCALE_RUNTIME_HIERARCHY", `${label}._$authoredContent.nodes must be an array.`);
    const targets: Array<{ path: string; instanceId: unknown }> = [];
    for (const [index, value] of authored.nodes.entries()) {
        const node = plainRecord(value, `${label}._$authoredContent.nodes[${index}]`);
        if (node.kind !== "dynamic-text") continue;
        if (!Array.isArray(node.animatorOwnerPath) || node.animatorOwnerPath.some(segment => typeof segment !== "string"))
            fail("AUTHORED_CONTENT_LOCALE_RUNTIME_HIERARCHY", `${label}._$authoredContent.nodes[${index}].animatorOwnerPath must be a string array.`);
        const path = node.animatorOwnerPath as string[];
        if (path.some(segment => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")))
            fail("AUTHORED_CONTENT_LOCALE_RUNTIME_HIERARCHY", `${label}._$authoredContent.nodes[${index}].animatorOwnerPath is not normalized.`);
        targets.push({ path: path.length === 0 ? "$" : path.join("/"), instanceId: node.instanceId });
    }
    const counts = new Map<string, number>();
    targets.forEach(target => counts.set(target.path, (counts.get(target.path) ?? 0) + 1));
    const resolved = targets.map(target => {
        if (counts.get(target.path) === 1) return target.path;
        const instanceId = requiredString(target.instanceId, `${label} duplicate dynamic-text instanceId`);
        if (!/^character_\d+\$d\d+\$f\d+\$i\d+$/.test(instanceId))
            fail("AUTHORED_CONTENT_LOCALE_RUNTIME_TARGET_AMBIGUOUS",
                `${label} duplicate dynamic-text path '${target.path}' has no unique placement identity.`);
        const slash = target.path.lastIndexOf("/");
        return slash < 0 ? instanceId : `${target.path.slice(0, slash)}/${instanceId}`;
    });
    if (new Set(resolved).size !== resolved.length)
        fail("AUTHORED_CONTENT_LOCALE_RUNTIME_TARGET_AMBIGUOUS", `${label} contains duplicate dynamic-text placement identities.`);
    return resolved;
}

function derivationMode(value: unknown, label: string): "strict" | "text-map-only" {
    if (value === "strict" || value === "text-map-only") return value;
    fail("AUTHORED_CONTENT_LOCALE_MODE", `${label} must equal 'strict' or 'text-map-only'.`);
}

async function resolveInput(root: string, relative: string, label: string): Promise<string> {
    const segments = relative.split("/");
    let current = root;
    for (const segment of segments) {
        current = path.join(current, segment);
        const info = await lstat(current).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                fail("AUTHORED_CONTENT_LOCALE_INPUT_MISSING", `${label} does not exist.`);
            throw error;
        });
        if (info.isSymbolicLink())
            fail("AUTHORED_CONTENT_LOCALE_INPUT_SYMLINK", `${label} must not traverse a symbolic link or junction.`);
    }
    const resolved = await realpath(current);
    if (!inside(root, resolved))
        fail("AUTHORED_CONTENT_LOCALE_INPUT_ESCAPE", `${label} escapes the locale diff request directory.`);
    await requireRegularFile(resolved, label);
    return resolved;
}

async function readOutput(outputPath: string): Promise<Buffer | undefined> {
    try {
        const info = await lstat(outputPath);
        if (info.isSymbolicLink()) fail("AUTHORED_CONTENT_LOCALE_OUTPUT_SYMLINK", "Locale output must not be a symbolic link or junction.");
        if (!info.isFile()) fail("AUTHORED_CONTENT_LOCALE_OUTPUT_TYPE", "Locale output must be a regular file.");
        return await readFile(outputPath);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

async function atomicReplace(outputPath: string, bytes: Buffer): Promise<void> {
    const parent = path.dirname(outputPath);
    await mkdir(parent, { recursive: true });
    const temporary = path.join(parent, `.${path.basename(outputPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`);
    const handle = await open(temporary, "wx");
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    }
    finally { await handle.close(); }
    try {
        await renameWithRetry(temporary, outputPath);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
        try { await rename(source, destination); return; }
        catch (error) {
            last = error;
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "EPERM" && code !== "EACCES") break;
            await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }
    throw last;
}

async function requireRegularFile(value: string, label: string): Promise<void> {
    const info = await lstat(value).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("AUTHORED_CONTENT_LOCALE_INPUT_MISSING", `${label} does not exist.`);
        throw error;
    });
    if (info.isSymbolicLink()) fail("AUTHORED_CONTENT_LOCALE_INPUT_SYMLINK", `${label} must not be a symbolic link or junction.`);
    if (!info.isFile()) fail("AUTHORED_CONTENT_LOCALE_INPUT_TYPE", `${label} must be a regular file.`);
}

function absoluteFilePath(value: unknown, label: string): string {
    if (typeof value !== "string" || value !== value.trim() || !path.isAbsolute(value) || value.includes("\0"))
        fail("AUTHORED_CONTENT_LOCALE_ABSOLUTE_PATH", `${label} must be an absolute file path.`);
    return path.normalize(value);
}

function relativeInputPath(value: unknown, label: string): string {
    const text = requiredString(value, label);
    if (text.includes("\\") || text.includes(":") || text.startsWith("/")
        || text.split("/").some(segment => !portableSegment(segment)))
        fail("AUTHORED_CONTENT_LOCALE_INPUT_PATH", `${label} must be a normalized portable relative POSIX path.`);
    return text;
}

function portableSegment(value: string): boolean {
    return Boolean(value) && value !== "." && value !== ".." && !value.endsWith(".") && !value.endsWith(" ")
        && !/[\x00-\x1f]/.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

function requiredString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\0"))
        fail("AUTHORED_CONTENT_LOCALE_STRING", `${label} must be a stable non-empty string.`);
    return value.normalize("NFC");
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("AUTHORED_CONTENT_LOCALE_OBJECT_REQUIRED", `${label} must be an object.`);
    return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, required: readonly string[], label: string, optional: readonly string[] = []): void {
    const admitted = new Set(required);
    const missing = required.filter(key => !(key in source) && !optional.includes(key));
    const extra = Object.keys(source).filter(key => !admitted.has(key)).sort();
    if (missing.length || extra.length)
        fail("AUTHORED_CONTENT_LOCALE_DIFF_KEYS", `${label} has invalid keys (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}).`);
}

function inside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
    return portableIdentity(path.resolve(left)) === portableIdentity(path.resolve(right));
}

function portableIdentity(value: string): string {
    return process.platform === "win32" ? value.normalize("NFC").toLocaleLowerCase("en-US") : value.normalize("NFC");
}

function fail(code: string, message: string): never {
    throw new AuthoredContentToolError(code, message, { exitCode: 1 });
}
