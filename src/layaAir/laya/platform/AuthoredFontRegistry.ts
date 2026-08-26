import { ILaya } from "../../ILaya";
import type {
    TextAdvanceProvider,
    TextFontFamilyResolver,
    TextFontMetricsProvider,
} from "../display/Text";
import { Loader, type ILoadTask, type ILoadURL } from "../net/Loader";
import { URL } from "../net/URL";
import { Browser } from "../utils/Browser";
import { Utils } from "../utils/Utils";
import { PAL } from "./PlatformAdapters";

export type AuthoredFontStyle = "regular" | "bold" | "italic" | "boldItalic";

export interface AuthenticatedFontReceiptIdentity {
    readonly key: string;
    readonly sourceSha256: string;
}

export interface AuthenticatedFontLoadReceipt {
    readonly family: string;
    readonly identity: AuthenticatedFontReceiptIdentity;
    readonly committed: boolean;
    readonly disposed: boolean;
    commit(): Promise<void>;
    dispose(): Promise<void>;
}

export type FontLoadResult = { family: string } | AuthenticatedFontLoadReceipt;

interface PreparedFontResource {
    readonly sourceSha256: string;
    commit(): void | Promise<void>;
    dispose(): void | Promise<void>;
}

export interface AuthoredFontKey {
    readonly documentId: string;
    readonly fontId: number;
    readonly fontStyle: AuthoredFontStyle;
    readonly sourceSha256: string;
}

export interface AuthoredPublishedFontSelection extends AuthoredFontKey {
    readonly fontName: string;
}

export interface AuthoredGlyphMetric {
    readonly index?: number;
    readonly codePoint: number;
    readonly advance: number;
    readonly bounds?: { readonly xmin: number; readonly xmax: number; readonly ymin: number; readonly ymax: number };
}

export interface AuthoredKerningMetric {
    readonly leftCodePoint: number;
    readonly rightCodePoint: number;
    readonly adjustment: number;
}

export interface AuthoredFontAlignZones {
    readonly tableHint: 0 | 1 | 2;
    readonly tableHintName: "thin" | "medium" | "thick";
    readonly zones: ReadonlyArray<{
        readonly data: ReadonlyArray<{ readonly alignmentCoordinate: number; readonly alignmentCoordinateBits: number; readonly range: number; readonly rangeBits: number }>;
        readonly maskX: boolean;
        readonly maskY: boolean;
    }>;
}

export interface AuthoredFontManifestEntry extends AuthoredFontKey {
    readonly fontName: string;
    readonly fontType: "embedded" | "embeddedCFF";
    readonly sourceUrl: string;
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly glyphs: readonly AuthoredGlyphMetric[];
    readonly leading?: number;
    readonly kerning?: readonly AuthoredKerningMetric[];
    readonly alignZones?: AuthoredFontAlignZones;
}

export interface AuthoredFontManifest {
    readonly schema: "laya-authored-font-manifest@1";
    readonly fonts: readonly AuthoredFontManifestEntry[];
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

type FrozenEntry = AuthoredFontManifestEntry & {
    readonly runtimeFamily: string;
    readonly glyphAdvances: Readonly<Record<string, number>>;
    readonly kerningAdjustments: Readonly<Record<string, number>>;
};

type BindingState = {
    active: boolean;
    readonly documentId: string;
    readonly consumer: AuthoredTextProviderConsumer;
    readonly previousMetrics: TextFontMetricsProvider;
    readonly previousFamily: TextFontFamilyResolver;
    readonly previousAdvance: TextAdvanceProvider;
    readonly metrics: TextFontMetricsProvider;
    readonly family: TextFontFamilyResolver;
    readonly advance: TextAdvanceProvider;
};

type ActiveFlashFontRecord = FrozenEntry & { readonly receipt: AuthenticatedFontLoadReceipt };

export interface FlashFontRecordView {
    readonly documentId: string;
    readonly fontId: number;
    readonly fontName: string;
    readonly fontStyle: AuthoredFontStyle;
    readonly fontType: "embedded" | "embeddedCFF";
    readonly sourceSha256: string;
    readonly glyphCodePoints: readonly number[];
}

const activeFlashRegistries = new Map<AuthoredFontRegistry, readonly ActiveFlashFontRecord[]>();
const FONT_TRANSACTION_PERMIT = Symbol("Laya font transaction permit");
const fontTransactionPermits = new WeakSet<object>();
const authenticatedFontReceipts = new WeakSet<object>();

/** @internal Read-only adapter ingress; it consumes but cannot mint an authorization. */
function consumeFontTransactionPermit(task: ILoadTask): boolean {
    const marker = (task.options as Record<PropertyKey, unknown>)[FONT_TRANSACTION_PERMIT];
    if (typeof marker !== "object" || marker === null || !fontTransactionPermits.has(marker)) return false;
    fontTransactionPermits.delete(marker);
    return true;
}

function isAuthenticatedFontLoadReceipt(value: unknown): value is AuthenticatedFontLoadReceipt {
    return typeof value === "object" && value !== null && authenticatedFontReceipts.has(value);
}

const MANIFEST_KEYS = Object.freeze(["fonts", "schema"]);
const ENTRY_KEYS = Object.freeze([
    "ascent", "descent", "documentId", "fontId", "fontName", "fontStyle", "fontType",
    "glyphs", "sourceSha256", "sourceUrl", "unitsPerEm",
]);
const EXTENDED_ENTRY_KEYS = Object.freeze([...ENTRY_KEYS, "alignZones", "kerning", "leading"]);
const GLYPH_KEYS = Object.freeze(["advance", "codePoint"]);
const EXTENDED_GLYPH_KEYS = Object.freeze(["advance", "bounds", "codePoint", "index"]);
const GLYPH_BOUNDS_KEYS = Object.freeze(["xmax", "xmin", "ymax", "ymin"]);
const KERNING_KEYS = Object.freeze(["adjustment", "leftCodePoint", "rightCodePoint"]);
const KEY_KEYS = Object.freeze(["documentId", "fontId", "fontStyle", "sourceSha256"]);
const SHA256 = /^[a-f0-9]{64}$/;
const FONT_EXTENSIONS = new Set(["ttf", "woff", "woff2", "otf"]);
const STYLES = Object.freeze(["regular", "bold", "italic", "boldItalic"] as const);

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
export class AuthoredFontRegistry {
    readonly manifest: AuthoredFontManifest;

    /** Sanitized read-only publication census; receipts and producer state never escape. */
    static enumeratePublishedFonts(): readonly FlashFontRecordView[] {
        return Object.freeze([...activeFlashRegistries.values()]
            .flatMap(records => records)
            .filter(record => record.receipt.committed && !record.receipt.disposed)
            .sort((left, right) => fontKey(left).localeCompare(fontKey(right)))
            .map(record => Object.freeze({
                documentId: record.documentId,
                fontId: record.fontId,
                fontName: record.fontName,
                fontStyle: record.fontStyle,
                fontType: record.fontType,
                sourceSha256: record.sourceSha256,
                glyphCodePoints: Object.freeze(record.glyphs.map(glyph => glyph.codePoint)),
            })));
    }

    /**
     * Binds a prefab-created field to one exact, already-authenticated font
     * catalog entry. A field cannot fall back to a device font while claiming
     * embedded authored identity.
     */
    static bindPublishedText(
        consumer: AuthoredTextProviderConsumer,
        selectionValue: AuthoredPublishedFontSelection,
    ): AuthoredFontBinding {
        const selectionRecord = exactDataObject(selectionValue, [...KEY_KEYS, "fontName"], "Published authored font selection");
        const selection = {
            ...normalizeKey(selectionRecord, "Published authored font selection"),
            fontName: requireNonemptyString(selectionRecord.fontName, "Published authored font selection.fontName"),
        };
        const matches = [...activeFlashRegistries].filter(([, records]) => records.some(record =>
            record.documentId === selection.documentId
            && record.fontId === selection.fontId
            && record.fontStyle === selection.fontStyle
            && record.sourceSha256 === selection.sourceSha256
            && record.fontName === selection.fontName));
        if (matches.length !== 1)
            throw new Error(matches.length === 0
                ? `No active authored font for ${printKey(selection)}`
                : `Ambiguous active authored font for ${printKey(selection)}`);
        return matches[0][0].bindText(consumer, selection.documentId);
    }

    private readonly entriesByDocument = new Map<string, readonly FrozenEntry[]>();
    private readonly entriesByKey = new Map<string, FrozenEntry>();
    private readonly loadedByKey = new Map<string, FrozenEntry>();
    private readonly loadedRuntimeFamilies = new Map<string, string>();
    private readonly pendingDocuments = new Map<string, Promise<readonly AuthoredFontRuntimeRecord[]>>();
    private readonly bindingWaiters = new Map<string, number>();
    private readonly bindingOnlyDocuments = new Set<string>();
    private readonly loadedDocuments = new Set<string>();
    private readonly receiptsByKey = new Map<string, AuthenticatedFontLoadReceipt>();
    private readonly bindings = new WeakMap<object, BindingState>();
    private readonly bindingStates = new Set<BindingState>();
    private disposePromise: Promise<void> | null = null;

    constructor(manifest: AuthoredFontManifest) {
        const normalized = normalizeManifest(manifest);
        this.manifest = normalized.manifest;

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

    async preload(documentId: string, signal?: AbortSignal): Promise<readonly AuthoredFontRuntimeRecord[]> {
        this.bindingOnlyDocuments.delete(documentId);
        return this.preloadDocument(documentId, signal);
    }

    private async preloadDocument(documentId: string, signal?: AbortSignal): Promise<readonly AuthoredFontRuntimeRecord[]> {
        if (this.disposePromise) throw new Error("Authored font registry is disposing");
        const entries = this.entriesByDocument.get(requireNonemptyString(documentId, "documentId"));
        if (!entries) throw new Error(`Unknown authored font document '${documentId}'`);
        if (signal?.aborted) throw new AuthoredFontBindingCancelledError();
        if (this.loadedDocuments.has(documentId)) return records(entries);
        const pending = this.pendingDocuments.get(documentId);
        if (pending) {
            const result = await pending;
            if (signal?.aborted) throw new AuthoredFontBindingCancelledError();
            return result;
        }

        // A document transaction is shared authority. An individual waiter's
        // cancellation must not poison it for the other live waiters.
        const operation = this.preloadAtomically(documentId, entries);
        this.pendingDocuments.set(documentId, operation);
        try {
            const result = await operation;
            if (signal?.aborted) throw new AuthoredFontBindingCancelledError();
            return result;
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
        const advance: TextAdvanceProvider = (text, font, size, bold, italic, kerning) => {
            if (typeof text !== "string") throw new TypeError("Authored text must be a string");
            requirePositiveFinite(size, "fontSize");
            const entry = resolve(font, bold, italic);
            const characters = Array.from(text);
            const values = characters.map((character, index) => {
                const codePoint = character.codePointAt(0)!;
                const units = entry.glyphAdvances[String(codePoint)];
                if (units == null)
                    throw new Error(`Authored font ${printKey(entry)} has no declared glyph U+${codePoint.toString(16).toUpperCase()}`);
                const nextCodePoint = characters[index + 1]?.codePointAt(0);
                const adjustment = kerning && nextCodePoint !== undefined
                    ? entry.kerningAdjustments[`${codePoint}:${nextCodePoint}`] ?? 0
                    : 0;
                return scaleFontUnits(units + adjustment, size, entry.unitsPerEm);
            });
            return Object.freeze(values);
        };
        const state: BindingState = {
            active: true,
            documentId,
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
        this.bindingStates.add(state);
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
        const id = requireNonemptyString(documentId, "documentId");
        if (!this.loadedDocuments.has(id) && !this.pendingDocuments.has(id))
            this.bindingOnlyDocuments.add(id);
        this.bindingWaiters.set(id, (this.bindingWaiters.get(id) ?? 0) + 1);
        let waiterReleased = false;
        const releaseWaiter = () => {
            if (waiterReleased) return;
            waiterReleased = true;
            const remaining = (this.bindingWaiters.get(id) ?? 1) - 1;
            if (remaining > 0) this.bindingWaiters.set(id, remaining);
            else this.bindingWaiters.delete(id);
        };
        let cancelled = false;
        const onAbort = () => { cancelled = true; };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            await this.preloadDocument(id, signal);
            if (cancelled || signal?.aborted || consumer.destroyed) throw new AuthoredFontBindingCancelledError();
            const binding = this.bindText(consumer, id);
            this.bindingOnlyDocuments.delete(id);
            return binding;
        } catch (error) {
            releaseWaiter();
            if (this.bindingOnlyDocuments.has(id) && !this.bindingWaiters.has(id)
                && ![...this.bindingStates].some(state => state.documentId === id)) {
                this.bindingOnlyDocuments.delete(id);
                if (this.loadedDocuments.has(id)) await this.disposeDocument(id);
            }
            throw error;
        } finally {
            releaseWaiter();
            signal?.removeEventListener("abort", onAbort);
        }
    }

    activateFlashBridge(): AuthoredFontBinding {
        if (activeFlashRegistries.has(this))
            throw new Error("Flash font bridge is already active for this registry");
        const candidates: readonly ActiveFlashFontRecord[] = Object.freeze([...this.loadedByKey.values()]
            .sort((left, right) => fontKey(left).localeCompare(fontKey(right)))
            .map(entry => Object.freeze({
                ...entry,
                receipt: this.receiptsByKey.get(fontKey(entry))!,
            })));
        if (candidates.length === 0 || candidates.some(candidate =>
            !isAuthenticatedFontLoadReceipt(candidate.receipt)
            || !candidate.receipt.committed || candidate.receipt.disposed
            || candidate.receipt.identity.key !== fontKey(candidate)
            || candidate.receipt.identity.sourceSha256 !== candidate.sourceSha256
            || candidate.receipt.family !== candidate.runtimeFamily))
            throw new Error("Flash font bridge requires committed authenticated font receipts");
        activeFlashRegistries.set(this, candidates);
        const registry = this;
        let active = true;
        return Object.freeze({
            get active() { return active; },
            cancel() {
                if (!active) return;
                active = false;
                activeFlashRegistries.delete(registry);
            },
        });
    }

    async disposeDocument(documentId: string): Promise<void> {
        const id = requireNonemptyString(documentId, "documentId");
        const pending = this.pendingDocuments.get(id);
        if (pending) await pending.catch(() => undefined);
        const entries = this.entriesByDocument.get(id);
        if (!entries) throw new Error(`Unknown authored font document '${id}'`);
        for (const state of [...this.bindingStates]) {
            if (state.documentId === id) this.cancelBinding(state);
        }
        const receipts = entries.flatMap(entry => {
            const receipt = this.receiptsByKey.get(fontKey(entry));
            return receipt ? [receipt] : [];
        });
        let disposalFailure: unknown;
        try {
            await disposeReceipts(receipts);
        } catch (error) {
            disposalFailure = error;
        } finally {
            // A receipt invalidates itself even when the platform's unregister
            // hook rejects. Never leave an unusable half-disposed document
            // published as loaded; callers may retry a fresh transaction.
            for (const entry of entries) {
                const key = fontKey(entry);
                this.receiptsByKey.delete(key);
                this.loadedByKey.delete(key);
                if (this.loadedRuntimeFamilies.get(entry.runtimeFamily) === key)
                    this.loadedRuntimeFamilies.delete(entry.runtimeFamily);
            }
            this.loadedDocuments.delete(id);
        }
        if (disposalFailure !== undefined) throw disposalFailure;
    }

    async dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        const operation = this.disposeAll();
        this.disposePromise = operation;
        try {
            await operation;
        } finally {
            if (this.disposePromise === operation) this.disposePromise = null;
        }
    }

    private async disposeAll(): Promise<void> {
        // Fence every in-flight transaction before returning. New transactions
        // are rejected while disposePromise is set, so none can commit after
        // this method has drained and disposed the pending cohort.
        while (this.pendingDocuments.size > 0)
            await Promise.allSettled([...this.pendingDocuments.values()]);
        for (const documentId of [...this.loadedDocuments]) await this.disposeDocument(documentId);
    }

    private async preloadAtomically(
        documentId: string,
        entries: readonly FrozenEntry[],
    ): Promise<readonly AuthoredFontRuntimeRecord[]> {
        const settled = await Promise.allSettled(entries.map(entry => {
            const authorization = Object.freeze({});
            fontTransactionPermits.add(authorization);
            const options: ILoadURL = {
                url: entry.sourceUrl,
                type: Loader.TTF,
                authoredFontFamily: entry.runtimeFamily,
                authoredFontIdentity: fontKey(entry),
                authoredFontSourceSha256: entry.sourceSha256,
                cache: false,
                ignoreCache: true,
                noRetry: true,
                [FONT_TRANSACTION_PERMIT]: authorization,
            };
            return ILaya.loader.load(options);
        }));
        const prepared: Array<{ entry: FrozenEntry; receipt: AuthenticatedFontLoadReceipt }> = [];
        const failures: string[] = [];
        settled.forEach((result, index) => {
            const entry = entries[index];
            if (result.status === "rejected") {
                const reason = result.reason instanceof Error ? `: ${result.reason.message}` : "";
                failures.push(`Failed to preload authored font ${printKey(entry)}${reason}`);
                return;
            }
            const receipt = result.value;
            if (!isAuthenticatedFontLoadReceipt(receipt)
                || receipt.family !== entry.runtimeFamily
                || receipt.identity.key !== fontKey(entry)
                || receipt.identity.sourceSha256 !== entry.sourceSha256) {
                failures.push(`Authored font loader did not return an exact authenticated receipt for '${entry.runtimeFamily}'`);
                return;
            }
            prepared.push({ entry, receipt });
        });
        if (failures.length) {
            await disposeReceipts(prepared.map(item => item.receipt));
            throw new Error(failures[0]);
        }

        for (const { entry } of prepared) {
            const owner = this.loadedRuntimeFamilies.get(entry.runtimeFamily);
            if (owner && owner !== fontKey(entry))
                failures.push(`Runtime font family collision '${entry.runtimeFamily}'`);
        }
        if (failures.length) {
            await disposeReceipts(prepared.map(item => item.receipt));
            throw new Error(failures[0]);
        }

        const commits = await Promise.allSettled(prepared.map(item => item.receipt.commit()));
        const commitFailure = commits.find(result => result.status === "rejected");
        if (commitFailure) {
            await disposeReceipts(prepared.map(item => item.receipt));
            const reason = commitFailure?.status === "rejected" && commitFailure.reason instanceof Error
                ? `: ${commitFailure.reason.message}` : "";
            throw new Error(`Failed to commit authored font document '${documentId}'${reason}`);
        }
        for (const { entry, receipt } of prepared) {
            const key = fontKey(entry);
            this.loadedByKey.set(key, entry);
            this.loadedRuntimeFamilies.set(entry.runtimeFamily, key);
            this.receiptsByKey.set(key, receipt);
        }
        this.loadedDocuments.add(documentId);
        return records(entries);
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
        this.bindingStates.delete(state);
    }
}

/** Platform font adapter. Authenticated receipt branding remains private to this module. */
export class FontAdapter {
    loadFont(task: ILoadTask): Promise<FontLoadResult | null> {
        const fontName = this.resolveFamily(task);
        if (task.options.authoredFontIdentity != null) {
            if (!consumeFontTransactionPermit(task))
                throw new Error("Authored font loading requires an engine registry transaction");
            return this.prepareAuthenticatedPlatform(task, fontName).then(prepared =>
                prepared ? this.#createAuthenticatedReceipt(task, fontName, prepared) : null);
        }
        const url = URL.postFormatURL(URL.formatURL(task.url));
        return Browser.window.FontFace
            ? this.loadByFontFace(task, url, fontName)
            : this.loadByCSS(task, url, fontName);
    }

    protected async prepareAuthenticatedPlatform(
        task: ILoadTask,
        fontName: string,
    ): Promise<PreparedFontResource | null> {
        if (!Browser.window.FontFace || !Browser.document?.fonts) return null;
        const authenticated = await this.fetchAuthenticatedBytes(task);
        if (!authenticated) return null;
        const fontFace: any = new Browser.window.FontFace(fontName, authenticated.bytes);
        await fontFace.load();
        const fonts = Browser.document.fonts as any;
        return {
            sourceSha256: authenticated.sourceSha256,
            commit: () => { fonts.add(fontFace); },
            dispose: () => { fonts.delete?.(fontFace); },
        };
    }

    protected async fetchAuthenticatedBytes(
        task: ILoadTask,
    ): Promise<{ bytes: ArrayBuffer; sourceSha256: string } | null> {
        const expected = task.options.authoredFontSourceSha256;
        if (typeof expected !== "string" || !SHA256.test(expected))
            throw new TypeError("authoredFontSourceSha256 must be lowercase SHA-256");
        const bytes = await task.loader.fetch(task.url, "arraybuffer", task.progress?.createCallback(), {
            ...task.options, cache: false, ignoreCache: true, noRetry: true,
        });
        if (!(bytes instanceof ArrayBuffer)) return null;
        const snapshot = bytes.slice(0);
        const actual = await rawSha256(snapshot);
        if (actual !== expected)
            throw new Error(`Authenticated font bytes do not match sourceSha256 (expected ${expected}, got ${actual})`);
        return { bytes: snapshot, sourceSha256: actual };
    }

    #createAuthenticatedReceipt(
        task: ILoadTask,
        family: string,
        prepared: PreparedFontResource,
    ): AuthenticatedFontLoadReceipt {
        const key = task.options.authoredFontIdentity;
        if (typeof key !== "string" || key.length === 0)
            throw new TypeError("authoredFontIdentity must be a non-empty engine identity");
        let committed = false;
        let disposed = false;
        const identity = Object.freeze({ key, sourceSha256: prepared.sourceSha256 });
        const receipt: AuthenticatedFontLoadReceipt = Object.freeze({
            family,
            identity,
            get committed() { return committed; },
            get disposed() { return disposed; },
            async commit() {
                if (disposed) throw new Error("Cannot commit a disposed font receipt");
                if (committed) return;
                await prepared.commit();
                committed = true;
            },
            async dispose() {
                if (disposed) return;
                try { await prepared.dispose(); }
                finally { disposed = true; committed = false; }
            },
        });
        authenticatedFontReceipts.add(receipt);
        return receipt;
    }

    protected resolveFamily(task: ILoadTask): string {
        const requested = task.options.authoredFontFamily;
        if (requested == null) return Utils.replaceFileExtension(Utils.getBaseName(task.url), "");
        if (typeof requested !== "string" || requested.length > 384
            || !/^LayaAuthored_[A-Za-z0-9_-]+$/.test(requested))
            throw new TypeError("authoredFontFamily must be a collision-safe Laya authored family name");
        return requested;
    }

    protected loadByFontFace(task: ILoadTask, url: string, fontName: string): Promise<{ family: string } | null> {
        const fontFace: any = new Browser.window.FontFace(fontName, "url('" + url + "')");
        const fonts = Browser.document.fonts as any;
        fonts.add(fontFace);
        return fontFace.load().then(() => fontFace, (error: unknown) => {
            fonts.delete?.(fontFace);
            throw error;
        });
    }

    protected loadByCSS(task: ILoadTask, url: string, fontName: string): Promise<{ family: string } | null> {
        const fontTxt = "40px " + fontName;
        Browser.context.font = fontTxt;
        const oldWidth = Browser.context.measureText(fontProbe).width;
        const fontStyle = Browser.createElement("style");
        fontStyle.type = "text/css";
        Browser.document.body.appendChild(fontStyle);
        fontStyle.textContent = "@font-face { font-family:'" + fontName + "'; src:url('" + url + "');}";
        return new Promise(resolve => {
            const checkComplete = () => {
                Browser.context.font = fontTxt;
                if (Browser.context.measureText(fontProbe).width !== oldWidth) complete(true);
            };
            const complete = (loaded = false) => {
                ILaya.systemTimer.clear(this, checkComplete);
                ILaya.systemTimer.clear(this, complete);
                if (!loaded) Browser.removeElement(fontStyle);
                resolve(loaded ? { family: fontName } : null);
            };
            ILaya.systemTimer.once(10000, this, complete, [false]);
            ILaya.systemTimer.loop(20, this, checkComplete);
        });
    }
}

const fontProbe = "LayaTTFFont";
PAL.register("font", FontAdapter);

async function rawSha256(bytes: ArrayBuffer): Promise<string> {
    const subtle = Browser.window.crypto?.subtle;
    if (!subtle) throw new Error("Authenticated font loading requires Web Crypto SHA-256");
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
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
        ...(entry.leading === undefined ? {} : { leading: entry.leading }),
        ...(entry.kerning === undefined ? {} : { kerning: entry.kerning }),
        ...(entry.alignZones === undefined ? {} : { alignZones: entry.alignZones }),
    })));
    return {
        entries,
        manifest: Object.freeze({ schema: "laya-authored-font-manifest@1", fonts }),
    };
}

function normalizeEntry(value: unknown, index: number): FrozenEntry {
    const label = `Authored font manifest fonts[${index}]`;
    const extended = hasOwnDataProperty(value, "leading") || hasOwnDataProperty(value, "kerning") || hasOwnDataProperty(value, "alignZones");
    const record = exactDataObject(value, extended ? EXTENDED_ENTRY_KEYS : ENTRY_KEYS, label);
    const key = normalizeKey(record, label);
    const fontName = requireNonemptyString(record.fontName, `${label}.fontName`);
    if (record.fontType !== "embedded" && record.fontType !== "embeddedCFF")
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
        const glyph = exactDataObject(candidate, extended ? EXTENDED_GLYPH_KEYS : GLYPH_KEYS, `${label}.glyphs[${glyphIndex}]`);
        if (extended && glyph.index !== glyphIndex)
            throw new Error(`${label}.glyphs indices must be contiguous source order`);
        const codePoint = requireCodePoint(glyph.codePoint, `${label}.glyphs[${glyphIndex}].codePoint`);
        if (codePoint <= previous) throw new Error(`${label}.glyphs must be strictly ordered by codePoint`);
        previous = codePoint;
        const advance = requireNonnegativeFinite(glyph.advance, `${label}.glyphs[${glyphIndex}].advance`);
        glyphAdvances[String(codePoint)] = advance;
        if (!extended) return Object.freeze({ codePoint, advance });
        const bounds = exactDataObject(glyph.bounds, GLYPH_BOUNDS_KEYS, `${label}.glyphs[${glyphIndex}].bounds`);
        for (const key of GLYPH_BOUNDS_KEYS) requireFinite(bounds[key], `${label}.glyphs[${glyphIndex}].bounds.${key}`);
        return Object.freeze({
            index: glyphIndex,
            codePoint,
            advance,
            bounds: Object.freeze({ xmin: bounds.xmin as number, xmax: bounds.xmax as number, ymin: bounds.ymin as number, ymax: bounds.ymax as number }),
        });
    }));
    const kerningAdjustments: Record<string, number> = Object.create(null);
    let leading: number | undefined;
    let kerning: readonly AuthoredKerningMetric[] | undefined;
    let alignZones: AuthoredFontAlignZones | undefined;
    if (extended) {
        leading = requireFinite(record.leading, `${label}.leading`);
        if (!Array.isArray(record.kerning)) throw new TypeError(`${label}.kerning must be an array`);
        let previousPair = -1;
        kerning = Object.freeze(record.kerning.map((candidate, pairIndex) => {
            const pair = exactDataObject(candidate, KERNING_KEYS, `${label}.kerning[${pairIndex}]`);
            const leftCodePoint = requireCodePoint(pair.leftCodePoint, `${label}.kerning[${pairIndex}].leftCodePoint`);
            const rightCodePoint = requireCodePoint(pair.rightCodePoint, `${label}.kerning[${pairIndex}].rightCodePoint`);
            const key = leftCodePoint * 0x110000 + rightCodePoint;
            if (key <= previousPair) throw new Error(`${label}.kerning must be unique and source-sorted`);
            previousPair = key;
            const adjustment = requireFinite(pair.adjustment, `${label}.kerning[${pairIndex}].adjustment`);
            kerningAdjustments[`${leftCodePoint}:${rightCodePoint}`] = adjustment;
            return Object.freeze({ leftCodePoint, rightCodePoint, adjustment });
        }));
        alignZones = normalizeFontAlignZones(record.alignZones, glyphs.length, `${label}.alignZones`);
    }
    return Object.freeze({
        ...key,
        fontName,
        fontType: record.fontType,
        sourceUrl,
        unitsPerEm,
        ascent,
        descent,
        glyphs,
        ...(leading === undefined ? {} : { leading }),
        ...(kerning === undefined ? {} : { kerning }),
        ...(alignZones === undefined ? {} : { alignZones }),
        runtimeFamily: runtimeFamily(key),
        glyphAdvances: Object.freeze(glyphAdvances),
        kerningAdjustments: Object.freeze(kerningAdjustments),
    });
}

function normalizeFontAlignZones(value: unknown, glyphCount: number, label: string): AuthoredFontAlignZones {
    const record = exactDataObject(value, ["tableHint", "tableHintName", "zones"], label);
    const table = normalizeFontAlignZoneTableHint(record.tableHint, record.tableHintName, label);
    if (!Array.isArray(record.zones) || record.zones.length !== glyphCount)
        throw new TypeError(`${label}.zones must match the glyph count`);
    const zones = Object.freeze(record.zones.map((candidate, index) => {
        const zone = exactDataObject(candidate, ["data", "maskX", "maskY"], `${label}.zones[${index}]`);
        if (!Array.isArray(zone.data) || zone.data.length !== 2)
            throw new TypeError(`${label}.zones[${index}].data must contain X and Y records`);
        const data = Object.freeze(zone.data.map((datumValue, dataIndex) => {
            const datum = exactDataObject(datumValue, ["alignmentCoordinate", "alignmentCoordinateBits", "range", "rangeBits"], `${label}.zones[${index}].data[${dataIndex}]`);
            const alignmentCoordinate = requireNonnegativeFinite(datum.alignmentCoordinate, `${label}.zones[${index}].data[${dataIndex}].alignmentCoordinate`);
            const range = requireNonnegativeFinite(datum.range, `${label}.zones[${index}].data[${dataIndex}].range`);
            const alignmentCoordinateBits = requireUint16(datum.alignmentCoordinateBits, `${label}.zones[${index}].data[${dataIndex}].alignmentCoordinateBits`);
            const rangeBits = requireUint16(datum.rangeBits, `${label}.zones[${index}].data[${dataIndex}].rangeBits`);
            return Object.freeze({ alignmentCoordinate, alignmentCoordinateBits, range, rangeBits });
        }));
        if (typeof zone.maskX !== "boolean" || typeof zone.maskY !== "boolean")
            throw new TypeError(`${label}.zones[${index}] masks must be boolean`);
        return Object.freeze({ data, maskX: zone.maskX, maskY: zone.maskY });
    }));
    return Object.freeze({ ...table, zones });
}

function normalizeFontAlignZoneTableHint(
    value: unknown, name: unknown, label: string,
): Pick<AuthoredFontAlignZones, "tableHint" | "tableHintName"> {
    if (value === 0 && name === "thin") return { tableHint: 0, tableHintName: "thin" };
    if (value === 1 && name === "medium") return { tableHint: 1, tableHintName: "medium" };
    if (value === 2 && name === "thick") return { tableHint: 2, tableHintName: "thick" };
    throw new TypeError(`${label} must retain a matching thin, medium, or thick table hint`);
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

function hasOwnDataProperty(value: unknown, key: string): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
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

function requireFinite(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new RangeError(`${label} must be finite`);
    return value;
}

function requireUint16(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff)
        throw new RangeError(`${label} must be a uint16 value`);
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
    if (bold && italic) return "boldItalic";
    if (bold) return "bold";
    if (italic) return "italic";
    return "regular";
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

async function disposeReceipts(receipts: readonly AuthenticatedFontLoadReceipt[]): Promise<void> {
    const failures = await Promise.allSettled([...receipts].reverse().map(receipt => receipt.dispose()));
    const failure = failures.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
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
