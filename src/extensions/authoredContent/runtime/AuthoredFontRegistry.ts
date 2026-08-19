import { ILaya } from "../../../layaAir/ILaya";
import { Font, type FlashFontClass, type FlashFontRegistryPort } from "../../../layaAir/flash/text/Font";
import { FontStyle } from "../../../layaAir/flash/text/TextFormat";
import { FontType } from "../../../layaAir/flash/text/FontType";
import type {
    TextAdvanceProvider,
    TextFontFamilyResolver,
    TextFontMetricsProvider,
} from "../../../layaAir/laya/display/Text";
import { Loader } from "../../../layaAir/laya/net/Loader";

export type AuthoredFontStyle = "regular" | "bold" | "italic" | "boldItalic";

export interface AuthoredFontKey {
    readonly documentId: string;
    readonly fontId: number;
    readonly fontStyle: AuthoredFontStyle;
    readonly sourceSha256: string;
}

export interface AuthoredGlyphMetric {
    readonly codePoint: number;
    readonly advance: number;
}

export interface AuthoredFontManifestEntry extends AuthoredFontKey {
    readonly fontName: string;
    readonly fontType: "embedded" | "embeddedCFF";
    readonly sourceUrl: string;
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly glyphs: readonly AuthoredGlyphMetric[];
}

export interface AuthoredFontManifest {
    readonly schema: "laya-authored-font-manifest@1";
    readonly fonts: readonly AuthoredFontManifestEntry[];
}

export interface AuthoredDeviceFontDescriptor {
    readonly fontName: string;
    readonly fontStyle: AuthoredFontStyle;
}

export interface AuthoredFontLoadResult {
    readonly family: string;
}

export interface AuthoredFontLoadPort {
    load(entry: AuthoredFontManifestEntry, runtimeFamily: string): Promise<AuthoredFontLoadResult | null>;
}

export interface AuthoredFontRuntimeRecord extends AuthoredFontKey {
    readonly fontName: string;
    readonly fontType: "embedded" | "embeddedCFF";
    readonly runtimeFamily: string;
}

export interface AuthoredTextProviderConsumer {
    readonly destroyed: boolean;
    fontMetricsProvider: TextFontMetricsProvider;
    fontFamilyResolver: TextFontFamilyResolver;
    textAdvanceProvider: TextAdvanceProvider;
}

export interface AuthoredFontBinding {
    readonly active: boolean;
    cancel(): void;
}

export interface AuthoredFontRegistryOptions {
    readonly loader?: AuthoredFontLoadPort;
    readonly deviceFonts?: readonly AuthoredDeviceFontDescriptor[];
}

type FrozenEntry = AuthoredFontManifestEntry & {
    readonly runtimeFamily: string;
    readonly glyphAdvances: Readonly<Record<string, number>>;
};

type BindingState = {
    active: boolean;
    readonly consumer: AuthoredTextProviderConsumer;
    readonly previousMetrics: TextFontMetricsProvider;
    readonly previousFamily: TextFontFamilyResolver;
    readonly previousAdvance: TextAdvanceProvider;
    readonly metrics: TextFontMetricsProvider;
    readonly family: TextFontFamilyResolver;
    readonly advance: TextAdvanceProvider;
};

const MANIFEST_KEYS = Object.freeze(["fonts", "schema"]);
const ENTRY_KEYS = Object.freeze([
    "ascent", "descent", "documentId", "fontId", "fontName", "fontStyle", "fontType",
    "glyphs", "sourceSha256", "sourceUrl", "unitsPerEm",
]);
const GLYPH_KEYS = Object.freeze(["advance", "codePoint"]);
const KEY_KEYS = Object.freeze(["documentId", "fontId", "fontStyle", "sourceSha256"]);
const DEVICE_KEYS = Object.freeze(["fontName", "fontStyle"]);
const SHA256 = /^[a-f0-9]{64}$/;
const FONT_EXTENSIONS = new Set(["ttf", "woff", "woff2", "otf"]);
const STYLES = Object.freeze([FontStyle.REGULAR, FontStyle.BOLD, FontStyle.ITALIC, FontStyle.BOLD_ITALIC] as const);

class LayaFontLoadPort implements AuthoredFontLoadPort {
    async load(entry: AuthoredFontManifestEntry, runtimeFamily: string): Promise<AuthoredFontLoadResult | null> {
        return ILaya.loader.load({
            url: entry.sourceUrl,
            type: Loader.TTF,
            authoredFontFamily: runtimeFamily,
            cache: false,
            ignoreCache: true,
            noRetry: true,
        });
    }
}

/** Explicit cancellation result: a cancelled/destroyed consumer is never bound. */
export class AuthoredFontBindingCancelledError extends Error {
    constructor() {
        super("Authored font binding was cancelled before publication");
        this.name = "AuthoredFontBindingCancelledError";
    }
}

/**
 * Immutable runtime authority for one or more already-converted authored font
 * manifests. It loads only normal Laya TTF/WOFF/WOFF2/OTF resources and does
 * not inspect or decode source containers.
 */
export class AuthoredFontRegistry implements FlashFontRegistryPort {
    readonly manifest: AuthoredFontManifest;

    private readonly loader: AuthoredFontLoadPort;
    private readonly entriesByDocument = new Map<string, readonly FrozenEntry[]>();
    private readonly entriesByKey = new Map<string, FrozenEntry>();
    private readonly loadedByKey = new Map<string, FrozenEntry>();
    private readonly loadedRuntimeFamilies = new Map<string, string>();
    private readonly pendingDocuments = new Map<string, Promise<readonly AuthoredFontRuntimeRecord[]>>();
    private readonly loadedDocuments = new Set<string>();
    private readonly bindings = new WeakMap<object, BindingState>();
    private readonly deviceFonts: readonly Font[];

    constructor(manifest: AuthoredFontManifest, options: AuthoredFontRegistryOptions = {}) {
        const normalized = normalizeManifest(manifest);
        this.manifest = normalized.manifest;
        this.loader = options.loader ?? new LayaFontLoadPort();
        if (!this.loader || typeof this.loader.load !== "function")
            throw new TypeError("Authored font loader must expose load(entry, runtimeFamily)");
        this.deviceFonts = normalizeDeviceFonts(options.deviceFonts ?? []);

        for (const entry of normalized.entries) {
            const key = fontKey(entry);
            if (this.entriesByKey.has(key)) throw new Error(`Duplicate authored font key ${printKey(entry)}`);
            this.entriesByKey.set(key, entry);
            const documentEntries = this.entriesByDocument.get(entry.documentId) ?? [];
            this.entriesByDocument.set(entry.documentId, Object.freeze([...documentEntries, entry]));
        }
        for (const [documentId, entries] of this.entriesByDocument) {
            const selections = new Set<string>();
            for (const entry of entries) {
                const selection = JSON.stringify([entry.fontName, entry.fontStyle]);
                if (selections.has(selection))
                    throw new Error(`Ambiguous authored font selection ${documentId}/${entry.fontName}/${entry.fontStyle}`);
                selections.add(selection);
            }
        }
    }

    isDocumentLoaded(documentId: string): boolean {
        return this.loadedDocuments.has(documentId);
    }

    runtimeFamilyFor(key: AuthoredFontKey): string {
        const entry = this.requireEntry(key);
        return entry.runtimeFamily;
    }

    async preload(documentId: string): Promise<readonly AuthoredFontRuntimeRecord[]> {
        const entries = this.entriesByDocument.get(requireNonemptyString(documentId, "documentId"));
        if (!entries) throw new Error(`Unknown authored font document '${documentId}'`);
        if (this.loadedDocuments.has(documentId)) return records(entries);
        const pending = this.pendingDocuments.get(documentId);
        if (pending) return pending;

        const operation = this.preloadAtomically(documentId, entries);
        this.pendingDocuments.set(documentId, operation);
        try {
            return await operation;
        } finally {
            if (this.pendingDocuments.get(documentId) === operation) this.pendingDocuments.delete(documentId);
        }
    }

    bindText(consumer: AuthoredTextProviderConsumer, documentId: string): AuthoredFontBinding {
        requireConsumer(consumer);
        if (consumer.destroyed) throw new AuthoredFontBindingCancelledError();
        if (!this.loadedDocuments.has(documentId))
            throw new Error(`Authored font document '${documentId}' must be preloaded before binding`);
        this.bindings.get(consumer)?.active && this.cancelBinding(this.bindings.get(consumer));

        const resolve = (font: string, bold: boolean, italic: boolean): FrozenEntry =>
            this.resolveLoaded(documentId, font, styleFor(bold, italic));
        const metrics: TextFontMetricsProvider = (font, size, bold, italic) => {
            const entry = resolve(font, bold, italic);
            requirePositiveFinite(size, "fontSize");
            return Object.freeze({
                ascent: scaleFontUnits(entry.ascent, size, entry.unitsPerEm),
                descent: scaleFontUnits(entry.descent, size, entry.unitsPerEm),
            });
        };
        const family: TextFontFamilyResolver = (font, bold, italic) => resolve(font, bold, italic).runtimeFamily;
        const advance: TextAdvanceProvider = (text, font, size, bold, italic) => {
            if (typeof text !== "string") throw new TypeError("Authored text must be a string");
            requirePositiveFinite(size, "fontSize");
            const entry = resolve(font, bold, italic);
            const values = Array.from(text, character => {
                const codePoint = character.codePointAt(0)!;
                const units = entry.glyphAdvances[String(codePoint)];
                if (units == null)
                    throw new Error(`Authored font ${printKey(entry)} has no declared glyph U+${codePoint.toString(16).toUpperCase()}`);
                return scaleFontUnits(units, size, entry.unitsPerEm);
            });
            return Object.freeze(values);
        };
        const state: BindingState = {
            active: true,
            consumer,
            previousMetrics: consumer.fontMetricsProvider,
            previousFamily: consumer.fontFamilyResolver,
            previousAdvance: consumer.textAdvanceProvider,
            metrics,
            family,
            advance,
        };
        consumer.fontMetricsProvider = metrics;
        consumer.fontFamilyResolver = family;
        consumer.textAdvanceProvider = advance;
        this.bindings.set(consumer, state);
        const binding = {
            get active() { return state.active; },
            cancel: () => this.cancelBinding(state),
        };
        return Object.freeze(binding);
    }

    async preloadAndBind(
        consumer: AuthoredTextProviderConsumer,
        documentId: string,
        signal?: AbortSignal,
    ): Promise<AuthoredFontBinding> {
        requireConsumer(consumer);
        if (consumer.destroyed || signal?.aborted) throw new AuthoredFontBindingCancelledError();
        let cancelled = false;
        const onAbort = () => { cancelled = true; };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            await this.preload(documentId);
            if (cancelled || signal?.aborted || consumer.destroyed) throw new AuthoredFontBindingCancelledError();
            return this.bindText(consumer, documentId);
        } finally {
            signal?.removeEventListener("abort", onAbort);
        }
    }

    enumerateFonts(includeDeviceFonts: boolean): readonly Font[] {
        const embedded = [...this.loadedByKey.values()]
            .sort((left, right) => fontKey(left).localeCompare(fontKey(right)))
            .map(entry => Font._fromEngine(entry));
        return Object.freeze(includeDeviceFonts ? [...embedded, ...this.deviceFonts] : embedded);
    }

    registerFontClass(fontClass: FlashFontClass): void {
        if (typeof fontClass !== "function")
            throw new TypeError("Font.registerFont requires a font class");
        const property = Object.getOwnPropertyDescriptor(fontClass, "authoredFont");
        if (!property || !("value" in property))
            throw new TypeError("Font class authoredFont must be an own data property");
        const descriptor = exactDataObject(property.value, KEY_KEYS, "Font class authoredFont");
        const entry = this.requireEntry(normalizeKey(descriptor));
        if (!this.loadedByKey.has(fontKey(entry)))
            throw new Error(`Font.registerFont requires preloaded authored font ${printKey(entry)}`);
    }

    activateFlashBridge(): AuthoredFontBinding {
        const release = Font._installEngineRegistry(this);
        let active = true;
        return Object.freeze({
            get active() { return active; },
            cancel() {
                if (!active) return;
                active = false;
                release();
            },
        });
    }

    private async preloadAtomically(
        documentId: string,
        entries: readonly FrozenEntry[],
    ): Promise<readonly AuthoredFontRuntimeRecord[]> {
        const results = await Promise.all(entries.map(async entry => {
            let result: AuthoredFontLoadResult | null;
            try {
                result = await this.loader.load(entry, entry.runtimeFamily);
            } catch (error) {
                const reason = error instanceof Error ? `: ${error.message}` : "";
                throw new Error(`Failed to preload authored font ${printKey(entry)}${reason}`);
            }
            if (!result || result.family !== entry.runtimeFamily)
                throw new Error(`Authored font loader did not publish collision-safe family '${entry.runtimeFamily}'`);
            return entry;
        }));

        for (const entry of results) {
            const owner = this.loadedRuntimeFamilies.get(entry.runtimeFamily);
            if (owner && owner !== fontKey(entry))
                throw new Error(`Runtime font family collision '${entry.runtimeFamily}'`);
        }
        for (const entry of results) {
            const key = fontKey(entry);
            this.loadedByKey.set(key, entry);
            this.loadedRuntimeFamilies.set(entry.runtimeFamily, key);
        }
        this.loadedDocuments.add(documentId);
        return records(results);
    }

    private resolveLoaded(documentId: string, fontName: string, style: AuthoredFontStyle): FrozenEntry {
        if (typeof fontName !== "string" || fontName.length === 0) throw new TypeError("fontName must not be empty");
        const entries = this.entriesByDocument.get(documentId);
        const entry = entries?.find(candidate => candidate.fontName === fontName && candidate.fontStyle === style);
        if (!entry || !this.loadedByKey.has(fontKey(entry)))
            throw new Error(`No loaded authored font for ${documentId}/${fontName}/${style}; device fallback is not permitted`);
        return entry;
    }

    private requireEntry(key: AuthoredFontKey): FrozenEntry {
        const normalized = normalizeKey(exactDataObject(key, KEY_KEYS, "Authored font key"));
        const entry = this.entriesByKey.get(fontKey(normalized));
        if (!entry) throw new Error(`Unknown authored font ${printKey(normalized)}`);
        return entry;
    }

    private cancelBinding(state: BindingState | undefined): void {
        if (!state?.active) return;
        state.active = false;
        const consumer = state.consumer;
        if (consumer.fontMetricsProvider === state.metrics) consumer.fontMetricsProvider = state.previousMetrics;
        if (consumer.fontFamilyResolver === state.family) consumer.fontFamilyResolver = state.previousFamily;
        if (consumer.textAdvanceProvider === state.advance) consumer.textAdvanceProvider = state.previousAdvance;
        if (this.bindings.get(consumer) === state) this.bindings.delete(consumer);
    }
}

function normalizeManifest(value: AuthoredFontManifest): { manifest: AuthoredFontManifest; entries: readonly FrozenEntry[] } {
    const record = exactDataObject(value, MANIFEST_KEYS, "Authored font manifest");
    if (record.schema !== "laya-authored-font-manifest@1")
        throw new TypeError("Authored font manifest schema must be laya-authored-font-manifest@1");
    if (!Array.isArray(record.fonts) || record.fonts.length === 0)
        throw new TypeError("Authored font manifest fonts must be a non-empty array");
    const entries = Object.freeze(record.fonts.map((candidate, index) => normalizeEntry(candidate, index)));
    const fonts = Object.freeze(entries.map(entry => Object.freeze({
        documentId: entry.documentId,
        fontId: entry.fontId,
        fontName: entry.fontName,
        fontStyle: entry.fontStyle,
        fontType: entry.fontType,
        sourceSha256: entry.sourceSha256,
        sourceUrl: entry.sourceUrl,
        unitsPerEm: entry.unitsPerEm,
        ascent: entry.ascent,
        descent: entry.descent,
        glyphs: entry.glyphs,
    })));
    return {
        entries,
        manifest: Object.freeze({ schema: "laya-authored-font-manifest@1", fonts }),
    };
}

function normalizeEntry(value: unknown, index: number): FrozenEntry {
    const label = `Authored font manifest fonts[${index}]`;
    const record = exactDataObject(value, ENTRY_KEYS, label);
    const key = normalizeKey(record, label);
    const fontName = requireNonemptyString(record.fontName, `${label}.fontName`);
    if (record.fontType !== FontType.EMBEDDED && record.fontType !== FontType.EMBEDDED_CFF)
        throw new TypeError(`${label}.fontType must be embedded or embeddedCFF`);
    const sourceUrl = requireNonemptyString(record.sourceUrl, `${label}.sourceUrl`);
    const extension = sourceUrl.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase();
    if (!extension || !FONT_EXTENSIONS.has(extension))
        throw new TypeError(`${label}.sourceUrl must identify a TTF, WOFF, WOFF2, or OTF resource`);
    const unitsPerEm = requirePositiveFinite(record.unitsPerEm, `${label}.unitsPerEm`);
    const ascent = requireNonnegativeFinite(record.ascent, `${label}.ascent`);
    const descent = requireNonnegativeFinite(record.descent, `${label}.descent`);
    if (!Array.isArray(record.glyphs) || record.glyphs.length === 0)
        throw new TypeError(`${label}.glyphs must be a non-empty array`);
    const glyphAdvances: Record<string, number> = Object.create(null);
    let previous = -1;
    const glyphs = Object.freeze(record.glyphs.map((candidate, glyphIndex) => {
        const glyph = exactDataObject(candidate, GLYPH_KEYS, `${label}.glyphs[${glyphIndex}]`);
        const codePoint = requireCodePoint(glyph.codePoint, `${label}.glyphs[${glyphIndex}].codePoint`);
        if (codePoint <= previous) throw new Error(`${label}.glyphs must be strictly ordered by codePoint`);
        previous = codePoint;
        const advance = requireNonnegativeFinite(glyph.advance, `${label}.glyphs[${glyphIndex}].advance`);
        glyphAdvances[String(codePoint)] = advance;
        return Object.freeze({ codePoint, advance });
    }));
    return Object.freeze({
        ...key,
        fontName,
        fontType: record.fontType,
        sourceUrl,
        unitsPerEm,
        ascent,
        descent,
        glyphs,
        runtimeFamily: runtimeFamily(key),
        glyphAdvances: Object.freeze(glyphAdvances),
    });
}

function normalizeDeviceFonts(values: readonly AuthoredDeviceFontDescriptor[]): readonly Font[] {
    if (!Array.isArray(values)) throw new TypeError("deviceFonts must be an array");
    const seen = new Set<string>();
    return Object.freeze(values.map((value, index) => {
        const record = exactDataObject(value, DEVICE_KEYS, `deviceFonts[${index}]`);
        const fontName = requireNonemptyString(record.fontName, `deviceFonts[${index}].fontName`);
        const fontStyle = requireStyle(record.fontStyle, `deviceFonts[${index}].fontStyle`);
        const key = `${fontName}\u0000${fontStyle}`;
        if (seen.has(key)) throw new Error(`Duplicate device font snapshot entry ${fontName}/${fontStyle}`);
        seen.add(key);
        return Font._fromEngine({ fontName, fontStyle, fontType: FontType.DEVICE });
    }));
}

function normalizeKey(value: Record<string, unknown>, label = "Authored font key"): AuthoredFontKey {
    const documentId = requireNonemptyString(value.documentId, `${label}.documentId`);
    if (utf8Bytes(documentId).length > 128) throw new RangeError(`${label}.documentId exceeds 128 UTF-8 bytes`);
    const fontId = value.fontId;
    if (typeof fontId !== "number" || !Number.isInteger(fontId) || fontId <= 0)
        throw new RangeError(`${label}.fontId must be a positive integer`);
    const fontStyle = requireStyle(value.fontStyle, `${label}.fontStyle`);
    const sourceSha256 = value.sourceSha256;
    if (typeof sourceSha256 !== "string" || !SHA256.test(sourceSha256))
        throw new TypeError(`${label}.sourceSha256 must be lowercase SHA-256`);
    return Object.freeze({ documentId, fontId, fontStyle, sourceSha256 });
}

function exactDataObject(value: unknown, expectedKeys: readonly string[], label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new TypeError(`${label} must be a data object`);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string")
        || JSON.stringify([...keys].sort()) !== JSON.stringify([...expectedKeys].sort()))
        throw new TypeError(`${label} must contain exactly ${expectedKeys.join(", ")}`);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) throw new TypeError(`${label}.${key} must be an own data property`);
        result[key] = descriptor.value;
    }
    return result;
}

function requireConsumer(value: AuthoredTextProviderConsumer): void {
    if (!value || typeof value !== "object"
        || typeof value.destroyed !== "boolean")
        throw new TypeError("Authored font consumer must be a Text or TextField provider target");
}

function requireNonemptyString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must not be empty`);
    return value;
}

function requirePositiveFinite(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        throw new RangeError(`${label} must be positive and finite`);
    return value;
}

function requireNonnegativeFinite(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new RangeError(`${label} must be nonnegative and finite`);
    return value;
}

function requireCodePoint(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0x10ffff
        || value >= 0xd800 && value <= 0xdfff)
        throw new RangeError(`${label} must be a Unicode scalar value`);
    return value;
}

function requireStyle(value: unknown, label: string): AuthoredFontStyle {
    if (!STYLES.includes(value as AuthoredFontStyle)) throw new TypeError(`${label} has an unsupported value`);
    return value as AuthoredFontStyle;
}

function styleFor(bold: boolean, italic: boolean): AuthoredFontStyle {
    if (bold && italic) return FontStyle.BOLD_ITALIC;
    if (bold) return FontStyle.BOLD;
    if (italic) return FontStyle.ITALIC;
    return FontStyle.REGULAR;
}

function scaleFontUnits(value: number, fontSize: number, unitsPerEm: number): number {
    return value * fontSize / unitsPerEm;
}

function fontKey(value: AuthoredFontKey): string {
    return JSON.stringify([value.documentId, value.fontId, value.fontStyle, value.sourceSha256]);
}

function printKey(value: AuthoredFontKey): string {
    return `${value.documentId}/${value.fontId}/${value.fontStyle}/${value.sourceSha256}`;
}

function runtimeFamily(value: AuthoredFontKey): string {
    return `LayaAuthored_${base64Url(utf8Bytes(value.documentId))}_${value.fontId}_${value.fontStyle}_${value.sourceSha256}`;
}

function records(entries: readonly FrozenEntry[]): readonly AuthoredFontRuntimeRecord[] {
    return Object.freeze(entries.map(entry => Object.freeze({
        documentId: entry.documentId,
        fontId: entry.fontId,
        fontStyle: entry.fontStyle,
        sourceSha256: entry.sourceSha256,
        fontName: entry.fontName,
        fontType: entry.fontType,
        runtimeFamily: entry.runtimeFamily,
    })));
}

function utf8Bytes(value: string): number[] {
    const result: number[] = [];
    for (const character of Array.from(value)) {
        const codePoint = character.codePointAt(0)!;
        if (codePoint <= 0x7f) result.push(codePoint);
        else if (codePoint <= 0x7ff) result.push(0xc0 | codePoint >> 6, 0x80 | codePoint & 0x3f);
        else if (codePoint <= 0xffff)
            result.push(0xe0 | codePoint >> 12, 0x80 | codePoint >> 6 & 0x3f, 0x80 | codePoint & 0x3f);
        else result.push(0xf0 | codePoint >> 18, 0x80 | codePoint >> 12 & 0x3f,
            0x80 | codePoint >> 6 & 0x3f, 0x80 | codePoint & 0x3f);
    }
    return result;
}

function base64Url(bytes: readonly number[]): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let output = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const second = bytes[index + 1];
        const third = bytes[index + 2];
        output += alphabet[first >> 2];
        output += alphabet[(first & 3) << 4 | (second == null ? 0 : second >> 4)];
        if (second != null) output += alphabet[(second & 15) << 2 | (third == null ? 0 : third >> 6)];
        if (third != null) output += alphabet[third & 63];
    }
    return output;
}
