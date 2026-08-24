import { ApplicationDomain } from "../../../layaAir/flash/system/ApplicationDomain";
import { URL } from "../../../layaAir/laya/net/URL";
import {
    AuthoredFontRegistry,
    type AuthoredFontBinding,
    type AuthoredFontKey,
    type AuthoredFontManifest,
    type AuthoredFontManifestEntry,
} from "./AuthoredFontRegistry";

export const AUTHORED_FONT_STARTUP_SCHEMA = "laya-authored-font-startup@1" as const;
export const AUTHORED_FONT_CATALOG_NAME = "runtime-font-catalog.json" as const;

export interface AuthenticatedJsonReference {
    readonly url: string;
    readonly size: number;
    readonly sha256: string;
}

export interface AuthoredFontDefinitionManifest {
    readonly className: string;
    readonly fontName: string;
    readonly authoredFont: AuthoredFontKey;
}

export interface AuthoredFontStartupManifest {
    readonly schema: typeof AUTHORED_FONT_STARTUP_SCHEMA;
    readonly manifest: AuthenticatedJsonReference;
    readonly preloadOrder: readonly string[];
    readonly definitions: readonly AuthoredFontDefinitionManifest[];
}

export interface AuthoredFontCatalogResponse {
    readonly ok: boolean;
    readonly status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type AuthoredFontCatalogFetch = (
    input: string,
    init: {
        readonly cache: "no-store";
        readonly credentials: "same-origin";
        readonly method: "GET";
        readonly redirect: "error";
        readonly signal?: AbortSignal;
    },
) => Promise<AuthoredFontCatalogResponse>;

export interface AuthoredFontCatalogDigest {
    digest(algorithm: "SHA-256", data: BufferSource): Promise<ArrayBuffer>;
}

export interface AuthoredFontCatalogOptions {
    readonly applicationDomain?: ApplicationDomain;
    readonly fetch?: AuthoredFontCatalogFetch;
    readonly digest?: AuthoredFontCatalogDigest;
    readonly signal?: AbortSignal;
}

export interface AuthoredFontCatalogLoadOptions extends AuthoredFontCatalogOptions {
}

export interface AuthoredFontCatalogActivation {
    readonly startup: AuthoredFontStartupManifest;
    readonly registry: AuthoredFontRegistry;
    readonly flashBridge: AuthoredFontBinding;
    readonly definitions: Readonly<Record<string, Function>>;
    dispose(): Promise<void>;
}

type InstalledFontCatalog = {
    readonly fingerprint: string;
    readonly promise: Promise<AuthoredFontCatalogActivation>;
};

const installedCatalogs = new WeakMap<ApplicationDomain, Map<string, InstalledFontCatalog>>();
const SHA256 = /^[a-f0-9]{64}$/;
const APPLICATION_ID = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** Resolves the font catalog stored beside a game's logical font resources. */
export function authoredFontCatalogUrlForDirectory(directoryUrlValue: string): string {
    const directoryUrl = requireNonemptyString(directoryUrlValue, "directoryUrl");
    if (!directoryUrl.endsWith("/")) throw new TypeError("directoryUrl must end with '/'");
    return URL.join(directoryUrl, AUTHORED_FONT_CATALOG_NAME);
}

/** Loads all authored fonts published by one logical resource directory. */
export function loadAndActivateAuthoredFontDirectory(
    directoryUrl: string,
    options: AuthoredFontCatalogLoadOptions = {},
): Promise<AuthoredFontCatalogActivation> {
    return loadAndActivateAuthoredFontCatalog(
        authoredFontCatalogUrlForDirectory(directoryUrl),
        options,
    );
}

/** Loads a packaged startup catalog by URL, then authenticates its referenced font manifest. */
export async function loadAndActivateAuthoredFontCatalog(
    startupUrlValue: string,
    options: AuthoredFontCatalogLoadOptions = {},
): Promise<AuthoredFontCatalogActivation> {
    const startupUrl = requireNonemptyString(startupUrlValue, "startupUrl");
    const fetcher = options.fetch ?? fetch;
    if (typeof fetcher !== "function") throw new TypeError("Authored font catalog requires fetch");
    const response = await fetcher(startupUrl, {
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        redirect: "error",
        signal: options.signal,
    });
    if (!response?.ok)
        throw new Error(`Authored font startup returned HTTP ${response?.status ?? "unknown"}: ${startupUrl}`);
    const startupBuffer = await response.arrayBuffer();
    const startup = normalizeStartup(JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(startupBuffer),
    ));
    return activateNormalizedStartup(startupUrl, startup, options, fetcher);
}

/** Loads, authenticates and publishes a generated authored-font startup manifest. */
export function activateAuthoredFontCatalog(
    startupReferenceValue: AuthenticatedJsonReference,
    options: AuthoredFontCatalogOptions = {},
): Promise<AuthoredFontCatalogActivation> {
    const startupReference = normalizeReference(startupReferenceValue, "startupReference");
    const domain = options.applicationDomain ?? ApplicationDomain.currentDomain;
    if (!(domain instanceof ApplicationDomain))
        throw new TypeError("Authored font catalog requires an ApplicationDomain");
    const fetcher = options.fetch ?? fetch;
    const digest = options.digest ?? crypto.subtle;
    if (typeof fetcher !== "function") throw new TypeError("Authored font catalog requires fetch");
    if (!digest || typeof digest.digest !== "function") throw new TypeError("Authored font catalog requires SHA-256");
    const fingerprint = JSON.stringify(startupReference);
    let byUrl = installedCatalogs.get(domain);
    if (!byUrl) installedCatalogs.set(domain, byUrl = new Map());
    const existing = byUrl.get(startupReference.url);
    if (existing) {
        if (existing.fingerprint !== fingerprint)
            throw new Error(`Authored font startup '${startupReference.url}' changed after activation`);
        return existing.promise;
    }
    const promise = activate(startupReference, domain, fetcher, digest, options.signal);
    byUrl.set(startupReference.url, { fingerprint, promise });
    promise.catch(() => {
        if (byUrl!.get(startupReference.url)?.promise === promise) byUrl!.delete(startupReference.url);
    });
    return promise;
}

function activateNormalizedStartup(
    startupUrl: string,
    startup: AuthoredFontStartupManifest,
    options: AuthoredFontCatalogOptions,
    fetcher: AuthoredFontCatalogFetch,
): Promise<AuthoredFontCatalogActivation> {
    const domain = options.applicationDomain ?? ApplicationDomain.currentDomain;
    if (!(domain instanceof ApplicationDomain))
        throw new TypeError("Authored font catalog requires an ApplicationDomain");
    const digest = options.digest ?? crypto.subtle;
    if (!digest || typeof digest.digest !== "function") throw new TypeError("Authored font catalog requires SHA-256");
    const fingerprint = JSON.stringify(startup);
    let byUrl = installedCatalogs.get(domain);
    if (!byUrl) installedCatalogs.set(domain, byUrl = new Map());
    const existing = byUrl.get(startupUrl);
    if (existing) {
        if (existing.fingerprint !== fingerprint)
            throw new Error(`Authored font startup '${startupUrl}' changed after activation`);
        return existing.promise;
    }
    const promise = activateStartup(startup, domain, fetcher, digest, options.signal);
    byUrl.set(startupUrl, { fingerprint, promise });
    promise.catch(() => {
        if (byUrl!.get(startupUrl)?.promise === promise) byUrl!.delete(startupUrl);
    });
    return promise;
}

async function activate(
    startupReference: AuthenticatedJsonReference,
    domain: ApplicationDomain,
    fetcher: AuthoredFontCatalogFetch,
    digest: AuthoredFontCatalogDigest,
    signal?: AbortSignal,
): Promise<AuthoredFontCatalogActivation> {
    const startup = normalizeStartup(await readAuthenticatedJson(startupReference, fetcher, digest, signal));
    return activateStartup(startup, domain, fetcher, digest, signal);
}

async function activateStartup(
    startup: AuthoredFontStartupManifest,
    domain: ApplicationDomain,
    fetcher: AuthoredFontCatalogFetch,
    digest: AuthoredFontCatalogDigest,
    signal?: AbortSignal,
): Promise<AuthoredFontCatalogActivation> {
    const manifest = await readAuthenticatedJson(startup.manifest, fetcher, digest, signal) as AuthoredFontManifest;
    const registry = new AuthoredFontRegistry(manifest);
    const definitions = createDefinitions(startup, registry.manifest);
    for (const [className, definition] of Object.entries(definitions)) {
        if (domain.hasDefinition(className) && domain.getDefinition(className) !== definition)
            throw new Error(`Authored font definition collision: ${className}`);
    }

    let flashBridge: AuthoredFontBinding | null = null;
    try {
        for (const documentId of startup.preloadOrder) await registry.preload(documentId, signal);
        flashBridge = registry.activateFlashBridge();
        for (const [className, definition] of Object.entries(definitions))
            domain.registerDefinition(className, definition);
    } catch (error) {
        flashBridge?.cancel();
        await registry.dispose().catch(() => undefined);
        throw error;
    }

    let disposed = false;
    return Object.freeze({
        startup,
        registry,
        flashBridge,
        definitions,
        async dispose(): Promise<void> {
            if (disposed) return;
            disposed = true;
            flashBridge!.cancel();
            await registry.dispose();
        },
    });
}

async function readAuthenticatedJson(
    reference: AuthenticatedJsonReference,
    fetcher: AuthoredFontCatalogFetch,
    digest: AuthoredFontCatalogDigest,
    signal?: AbortSignal,
): Promise<unknown> {
    if (signal?.aborted) throw signal.reason;
    const response = await fetcher(reference.url, {
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        redirect: "error",
        signal,
    });
    if (!response?.ok) throw new Error(`Authored font catalog returned HTTP ${response?.status ?? "unknown"}: ${reference.url}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== reference.size)
        throw new Error(`Authored font catalog byte length mismatch: ${reference.url}`);
    const actual = byteHex(new Uint8Array(await digest.digest("SHA-256", buffer)));
    if (actual !== reference.sha256)
        throw new Error(`Authored font catalog SHA-256 mismatch: ${reference.url}`);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
}

function normalizeStartup(value: unknown): AuthoredFontStartupManifest {
    const source = requirePlainRecord(value, "startup");
    requireExactKeys(source, ["schema", "manifest", "preloadOrder", "definitions"], "startup");
    if (source.schema !== AUTHORED_FONT_STARTUP_SCHEMA)
        throw new TypeError(`startup.schema must equal ${AUTHORED_FONT_STARTUP_SCHEMA}`);
    const manifest = normalizeReference(source.manifest, "startup.manifest");
    if (!Array.isArray(source.preloadOrder) || source.preloadOrder.length === 0)
        throw new TypeError("startup.preloadOrder must be a non-empty array");
    const documents = new Set<string>();
    const preloadOrder = source.preloadOrder.map((value, index) =>
        requireUniqueString(value, `startup.preloadOrder[${index}]`, documents));
    if (!Array.isArray(source.definitions) || source.definitions.length === 0)
        throw new TypeError("startup.definitions must be a non-empty array");
    const classes = new Set<string>();
    const definitions = source.definitions.map((value, index): AuthoredFontDefinitionManifest => {
        const path = `startup.definitions[${index}]`;
        const definition = requirePlainRecord(value, path);
        requireExactKeys(definition, ["className", "fontName", "authoredFont"], path);
        const className = requireUniqueString(definition.className, `${path}.className`, classes);
        if (!isApplicationId(className)) throw new TypeError(`${path}.className must be an application-owned definition name`);
        const fontName = requireNonemptyString(definition.fontName, `${path}.fontName`);
        const key = normalizeFontKey(definition.authoredFont, `${path}.authoredFont`);
        return Object.freeze({ className, fontName, authoredFont: key });
    });
    return Object.freeze({
        schema: AUTHORED_FONT_STARTUP_SCHEMA,
        manifest,
        preloadOrder: Object.freeze(preloadOrder),
        definitions: Object.freeze(definitions),
    });
}

function createDefinitions(
    startup: AuthoredFontStartupManifest,
    manifest: AuthoredFontManifest,
): Readonly<Record<string, Function>> {
    const documents = new Set(manifest.fonts.map(entry => entry.documentId));
    if (startup.preloadOrder.length !== documents.size
        || startup.preloadOrder.some(documentId => !documents.has(documentId)))
        throw new Error("Authored font preload order must cover every manifest document exactly once");
    if (startup.definitions.length !== manifest.fonts.length)
        throw new Error("Authored font definitions must cover every manifest entry exactly once");
    const matched = new Set<AuthoredFontManifestEntry>();
    const result: Record<string, Function> = Object.create(null);
    for (const spec of startup.definitions) {
        const entry = manifest.fonts.find(candidate => sameKey(candidate, spec.authoredFont));
        if (!entry || entry.fontName !== spec.fontName || matched.has(entry))
            throw new Error(`Authored font definition '${spec.className}' does not match one unique manifest entry`);
        matched.add(entry);
        const definition = function AuthoredFontDefinition(): void {};
        Object.defineProperty(definition, "authoredFont", {
            value: Object.freeze({ ...spec.authoredFont }),
            configurable: false,
            enumerable: true,
            writable: false,
        });
        result[spec.className] = definition;
    }
    return Object.freeze(result);
}

function sameKey(left: AuthoredFontKey, right: AuthoredFontKey): boolean {
    return left.documentId === right.documentId && left.fontId === right.fontId
        && left.fontStyle === right.fontStyle && left.sourceSha256 === right.sourceSha256;
}

function normalizeReference(value: unknown, path: string): AuthenticatedJsonReference {
    const source = requirePlainRecord(value, path);
    requireExactKeys(source, ["url", "size", "sha256"], path);
    const url = requireNonemptyString(source.url, `${path}.url`);
    if (!Number.isSafeInteger(source.size) || (source.size as number) <= 0)
        throw new TypeError(`${path}.size must be a positive safe integer`);
    if (typeof source.sha256 !== "string" || !SHA256.test(source.sha256))
        throw new TypeError(`${path}.sha256 must be a lowercase SHA-256 digest`);
    return Object.freeze({ url, size: source.size as number, sha256: source.sha256 });
}

function normalizeFontKey(value: unknown, path: string): AuthoredFontKey {
    const source = requirePlainRecord(value, path);
    requireExactKeys(source, ["documentId", "fontId", "fontStyle", "sourceSha256"], path);
    const documentId = requireNonemptyString(source.documentId, `${path}.documentId`);
    if (!Number.isSafeInteger(source.fontId) || (source.fontId as number) < 0)
        throw new TypeError(`${path}.fontId must be a non-negative safe integer`);
    if (source.fontStyle !== "regular" && source.fontStyle !== "bold"
        && source.fontStyle !== "italic" && source.fontStyle !== "boldItalic")
        throw new TypeError(`${path}.fontStyle is unsupported`);
    if (typeof source.sourceSha256 !== "string" || !SHA256.test(source.sourceSha256))
        throw new TypeError(`${path}.sourceSha256 must be a lowercase SHA-256 digest`);
    return Object.freeze({
        documentId,
        fontId: source.fontId as number,
        fontStyle: source.fontStyle,
        sourceSha256: source.sourceSha256,
    });
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

function requireUniqueString(value: unknown, path: string, seen: Set<string>): string {
    const text = requireNonemptyString(value, path);
    if (seen.has(text)) throw new Error(`${path} duplicates '${text}'`);
    seen.add(text);
    return text;
}

function isApplicationId(value: string): boolean {
    return APPLICATION_ID.test(value)
        && value !== "flash" && !value.startsWith("flash.")
        && value !== "laya" && !value.startsWith("laya.");
}

function byteHex(bytes: Uint8Array): string {
    let result = "";
    for (const value of bytes) result += value.toString(16).padStart(2, "0");
    return result;
}
