import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test, { afterEach } from "node:test";

import {
    AuthoredFontBindingCancelledError,
    AuthoredFontRegistry,
    type AuthoredFontManifest,
    type AuthoredFontManifestEntry,
} from "../../src/extensions/authoredContent/runtime/AuthoredFontRegistry";
import {
    activateAuthoredFontCatalog,
    authoredFontCatalogUrlForDirectory,
    loadAndActivateAuthoredFontCatalog,
    type AuthenticatedJsonReference,
} from "../../src/extensions/authoredContent/runtime/AuthoredFontCatalog";
import { ApplicationDomain } from "../../src/layaAir/flash/system/ApplicationDomain";
import { Font } from "../../src/layaAir/flash/text/Font";
import { FontType } from "../../src/layaAir/flash/text/FontType";
import { TextField } from "../../src/layaAir/flash/text/TextField";
import { TextFormat } from "../../src/layaAir/flash/text/TextFormat";
import { ILaya } from "../../src/layaAir/ILaya";
import { Text } from "../../src/layaAir/laya/display/Text";
import { Render2DProcessor } from "../../src/layaAir/laya/display/Render2DProcessor";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { FontAdapter } from "../../src/layaAir/laya/platform/FontAdapter";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import type { ILoadTask } from "../../src/layaAir/laya/net/Loader";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import { NativeFontAdapter } from "../../src/layaAir/platforms/native/NativeFontAdapter";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
(Render2DProcessor as unknown as { runner: unknown }).runner = { _textRender: { getFontHeight: (): number => 10 } };
Browser.context = {
    font: "10px Arial", fontKerning: "normal",
    measureText: (value: string) => ({ width: Array.from(value).length * 5 }),
} as unknown as CanvasRenderingContext2D;
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;
ILaya.timer = { callLater: (): void => undefined } as any;
ILaya.systemTimer = { callLater: (): void => undefined, runCallLater: (): void => undefined } as any;
(PAL as any).textInput = {
    target: null,
    begin(target: unknown): void { this.target = target; },
    end(): void { this.target = null; },
    setText: (): void => undefined, setSelection: (): void => undefined,
    syncSelection: (): void => undefined, syncText: (): void => undefined,
};
(PAL as any).browser ??= { on: (): void => undefined };

const GLYPHS = Object.freeze([
    Object.freeze({ codePoint: 0x20, advance: 250 }),
    Object.freeze({ codePoint: 0x41, advance: 600 }),
    Object.freeze({ codePoint: 0x56, advance: 620 }),
    Object.freeze({ codePoint: 0x1f4ae, advance: 1000 }),
]);
const ASSETS = new Map<string, ArrayBuffer>();

function bytes(token: string): ArrayBuffer {
    return Uint8Array.from(Buffer.from(`font:${token}`, "utf8")).buffer;
}

function sha(value: ArrayBuffer): string {
    return createHash("sha256").update(new Uint8Array(value)).digest("hex");
}

function entry(
    documentId: string,
    fontId: number,
    fontStyle: AuthoredFontManifestEntry["fontStyle"],
    token: string,
    overrides: Partial<AuthoredFontManifestEntry> = {},
): AuthoredFontManifestEntry {
    const sourceUrl = `fonts/${documentId}-${fontId}-${fontStyle}.woff2`;
    const source = bytes(token);
    ASSETS.set(sourceUrl, source);
    return {
        documentId, fontId, fontName: "Body", fontStyle, fontType: "embedded",
        sourceSha256: sha(source), sourceUrl, unitsPerEm: 1000, ascent: 800, descent: 200,
        glyphs: GLYPHS, ...overrides,
    };
}

function manifest(fonts: readonly AuthoredFontManifestEntry[]): AuthoredFontManifest {
    return { schema: "laya-authored-font-manifest@1", fonts };
}

function jsonBytes(value: unknown): ArrayBuffer {
    return Uint8Array.from(Buffer.from(JSON.stringify(value), "utf8")).buffer;
}

function reference(url: string, value: ArrayBuffer): AuthenticatedJsonReference {
    return { url, size: value.byteLength, sha256: sha(value) };
}

test("TextField.textColor recolors existing text and remains the insertion default", () => {
    const field = new TextField();
    try {
        assert.equal(field.textColor, 0);
        field.text = "AB";
        field.setTextFormat(new TextFormat(null, null, 0xff0000), 0, 1);

        field.textColor = 0x12ab34;
        assert.equal(field.textColor, 0x12ab34);
        assert.equal(field.defaultTextFormat.color, 0x12ab34);
        assert.equal(field.getTextFormat(0, 1).color, 0x12ab34);
        assert.equal(field.getTextFormat(1, 2).color, 0x12ab34);

        field.appendText("C");
        assert.equal(field.getTextFormat(2, 3).color, 0x12ab34);
    } finally {
        field.destroy(true);
    }
});

function keyOf(value: AuthoredFontManifestEntry) {
    return {
        documentId: value.documentId, fontId: value.fontId,
        fontStyle: value.fontStyle, sourceSha256: value.sourceSha256,
    };
}

type Deferred = { promise: Promise<void>; resolve(): void; reject(error: Error): void };
function deferred(): Deferred {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    return { promise: new Promise<void>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
}

class FontHarness {
    readonly installed = new Set<FakeFontFace>();
    readonly faces: FakeFontFace[] = [];
    readonly fetchCount = new Map<string, number>();
    readonly fetchSequences = new Map<string, ArrayBuffer[]>();
    readonly faceDeferred = new Map<string, Deferred>();
    readonly rejectCommitFamilies = new Set<string>();
    readonly rejectDisposeFamilies = new Set<string>();
    readonly adapter = new FontAdapter();

    constructor() {
        activeHarness = this;
        Object.defineProperty(Browser.window, "FontFace", { configurable: true, value: FakeFontFace });
        Object.defineProperty(Browser.window, "crypto", { configurable: true, value: webcrypto });
        Object.defineProperty(Browser.document, "fonts", {
            configurable: true,
            value: {
                add: (face: FakeFontFace) => {
                    if (this.rejectCommitFamilies.has(face.family)) throw new Error("platform commit rejected");
                    this.installed.add(face);
                },
                delete: (face: FakeFontFace) => {
                    if (this.rejectDisposeFamilies.has(face.family)) throw new Error("platform dispose rejected");
                    return this.installed.delete(face);
                },
            },
        });
        (ILaya as any).loader = {
            load: (options: Record<string, any>) => this.adapter.loadFont({
                url: options.url,
                options,
                progress: { createCallback: (): undefined => undefined },
                loader: { fetch: (url: string) => this.fetch(url) },
            } as unknown as ILoadTask),
        };
    }

    async fetch(url: string): Promise<ArrayBuffer | null> {
        const count = (this.fetchCount.get(url) ?? 0) + 1;
        this.fetchCount.set(url, count);
        const sequence = this.fetchSequences.get(url);
        return sequence?.[Math.min(count - 1, sequence.length - 1)] ?? ASSETS.get(url) ?? null;
    }
}

let activeHarness: FontHarness | null = null;
class FakeFontFace {
    constructor(public readonly family: string, public readonly source: ArrayBuffer) {
        activeHarness!.faces.push(this);
    }
    async load(): Promise<this> {
        const control = activeHarness!.faceDeferred.get(this.family);
        if (control) await control.promise;
        return this;
    }
}

afterEach(() => {
    activeHarness = null;
    ASSETS.clear();
});

test("immutable manifests give same-named documents collision-safe authenticated families", async () => {
    const alpha = entry("document-alpha", 7, "regular", "alpha");
    const beta = entry("document-beta", 7, "regular", "beta");
    const source = manifest([alpha, beta]);
    const harness = new FontHarness();
    const registry = new AuthoredFontRegistry(source);
    (alpha as { fontName: string }).fontName = "mutated";
    (source.fonts as AuthoredFontManifestEntry[]).length = 0;
    assert.equal(registry.manifest.fonts[0].fontName, "Body");
    assert.equal(Object.isFrozen(registry.manifest.fonts[0].glyphs), true);
    await Promise.all([registry.preload("document-alpha"), registry.preload("document-beta")]);
    assert.equal(harness.fetchCount.size, 2);
    const left = registry.runtimeFamilyFor(keyOf(registry.manifest.fonts[0]));
    const right = registry.runtimeFamilyFor(keyOf(registry.manifest.fonts[1]));
    assert.notEqual(left, right);
    assert.match(left, /^LayaAuthored_[A-Za-z0-9_-]+$/);
    assert.throws(() => new AuthoredFontRegistry(manifest([
        entry("ambiguous", 1, "regular", "one"), entry("ambiguous", 2, "regular", "two"),
    ])), /Ambiguous authored font selection/);
    await registry.dispose();
    assert.equal(harness.installed.size, 0);
});

test("style selection binds exact metrics and scalar advances to Text and TextField", async () => {
    const fonts = [
        entry("styled", 1, "regular", "regular"),
        entry("styled", 2, "bold", "bold", { ascent: 810, descent: 190 }),
        entry("styled", 3, "italic", "italic", { ascent: 790, descent: 210 }),
        entry("styled", 4, "boldItalic", "boldItalic", { ascent: 820, descent: 180 }),
    ];
    new FontHarness();
    const registry = new AuthoredFontRegistry(manifest(fonts));
    await registry.preload("styled");
    for (const consumer of [new Text(), new TextField()]) {
        const binding = registry.bindText(consumer, "styled");
        assert.equal(new Set([
            consumer.fontFamilyResolver("Body", false, false), consumer.fontFamilyResolver("Body", true, false),
            consumer.fontFamilyResolver("Body", false, true), consumer.fontFamilyResolver("Body", true, true),
        ]).size, 4);
        assert.deepEqual(consumer.fontMetricsProvider("Body", 12, false, false), { ascent: 9.6, descent: 2.4 });
        assert.deepEqual(consumer.fontMetricsProvider("Body", 10, true, false), { ascent: 8.1, descent: 1.9 });
        assert.deepEqual(consumer.textAdvanceProvider("AV💮", "Body", 10, false, false, true), [6, 6.2, 10]);
        assert.throws(() => consumer.textAdvanceProvider("B", "Body", 10, false, false, true), /no declared glyph U\+42/);
        assert.throws(() => consumer.fontFamilyResolver("Missing", false, false), /device fallback is not permitted/);
        binding.cancel();
        consumer.destroy();
    }
    await registry.dispose();
});

test("partial prepare failure and partial commit failure roll back every platform resource and retry", async () => {
    const regular = entry("atomic", 1, "regular", "first");
    const bold = entry("atomic", 2, "bold", "second");
    const harness = new FontHarness();
    const registry = new AuthoredFontRegistry(manifest([regular, bold]));
    harness.fetchSequences.set(bold.sourceUrl, [bytes("wrong")]);
    await assert.rejects(registry.preload("atomic"), /do not match sourceSha256/);
    assert.equal(harness.installed.size, 0);
    assert.equal(registry.isDocumentLoaded("atomic"), false);

    harness.fetchSequences.delete(bold.sourceUrl);
    const boldFamily = registry.runtimeFamilyFor(keyOf(bold));
    harness.rejectCommitFamilies.add(boldFamily);
    await assert.rejects(registry.preload("atomic"), /platform commit rejected/);
    assert.equal(harness.installed.size, 0, "a sibling committed before failure must be deleted");
    harness.rejectCommitFamilies.clear();
    assert.equal((await registry.preload("atomic")).length, 2);
    assert.equal(harness.installed.size, 2);
    await registry.disposeDocument("atomic");
    assert.equal(harness.installed.size, 0);
});

test("cancelled transaction and destroyed consumer publish neither resources nor providers", async () => {
    const authored = entry("cancelled", 1, "regular", "cancelled");
    const harness = new FontHarness();
    const registry = new AuthoredFontRegistry(manifest([authored]));
    const family = registry.runtimeFamilyFor(keyOf(authored));
    const control = deferred();
    harness.faceDeferred.set(family, control);
    const text = new Text();
    const controller = new AbortController();
    const pending = registry.preloadAndBind(text, "cancelled", controller.signal);
    controller.abort();
    control.resolve();
    await assert.rejects(pending, AuthoredFontBindingCancelledError);
    assert.equal(harness.installed.size, 0);
    assert.equal(text.fontFamilyResolver, undefined);

    harness.faceDeferred.clear();
    const field = new TextField();
    const bind = registry.preloadAndBind(field, "cancelled");
    field.destroy();
    await assert.rejects(bind, AuthoredFontBindingCancelledError);
    assert.equal(field.fontFamilyResolver, undefined);
    assert.equal(harness.installed.size, 0, "destroyed binding must roll back committed platform fonts");
    assert.equal(registry.isDocumentLoaded("cancelled"), false);
    await registry.dispose();
});

for (const abortingWaiterArrivesFirst of [true, false]) {
    test(`one cancelled shared waiter does not poison survivor when aborting waiter arrives ${abortingWaiterArrivesFirst ? "first" : "second"}`, async () => {
        const authored = entry(`shared-${abortingWaiterArrivesFirst ? "abort-first" : "abort-second"}`, 1, "regular", "shared");
        const harness = new FontHarness();
        const registry = new AuthoredFontRegistry(manifest([authored]));
        const family = registry.runtimeFamilyFor(keyOf(authored));
        const control = deferred();
        harness.faceDeferred.set(family, control);
        const cancelledConsumer = new Text();
        const survivingConsumer = new Text();
        const controller = new AbortController();
        const cancelled = () => registry.preloadAndBind(cancelledConsumer, authored.documentId, controller.signal);
        const surviving = () => registry.preloadAndBind(survivingConsumer, authored.documentId);
        const first = abortingWaiterArrivesFirst ? cancelled() : surviving();
        const second = abortingWaiterArrivesFirst ? surviving() : cancelled();
        controller.abort();
        control.resolve();
        const [firstResult, secondResult] = await Promise.allSettled([first, second]);
        const cancelledResult = abortingWaiterArrivesFirst ? firstResult : secondResult;
        const survivingResult = abortingWaiterArrivesFirst ? secondResult : firstResult;
        assert.equal(cancelledResult.status, "rejected");
        assert.ok(cancelledResult.status === "rejected"
            && cancelledResult.reason instanceof AuthoredFontBindingCancelledError);
        assert.equal(survivingResult.status, "fulfilled");
        assert.equal(harness.installed.size, 1, "the shared document publishes exactly once");
        assert.equal(registry.isDocumentLoaded(authored.documentId), true);
        assert.equal(cancelledConsumer.fontFamilyResolver, undefined);
        assert.equal(typeof survivingConsumer.fontFamilyResolver, "function");
        const bridge = registry.activateFlashBridge();
        assert.equal(Font.enumerateFonts(false).length, 1);
        bridge.cancel();
        if (survivingResult.status === "fulfilled") survivingResult.value.cancel();
        await registry.dispose();
        assert.equal(harness.installed.size, 0);
    });
}

test("all cancelled shared waiters leave zero font or provider publication", async () => {
    const authored = entry("shared-all-cancel", 1, "regular", "shared-all-cancel");
    const harness = new FontHarness();
    const registry = new AuthoredFontRegistry(manifest([authored]));
    const control = deferred();
    harness.faceDeferred.set(registry.runtimeFamilyFor(keyOf(authored)), control);
    const consumers = [new Text(), new Text()];
    const controllers = [new AbortController(), new AbortController()];
    const waiters = consumers.map((consumer, index) =>
        registry.preloadAndBind(consumer, authored.documentId, controllers[index].signal));
    controllers.forEach(controller => controller.abort());
    control.resolve();
    const results = await Promise.allSettled(waiters);
    assert.ok(results.every(result => result.status === "rejected"
        && result.reason instanceof AuthoredFontBindingCancelledError));
    assert.equal(harness.installed.size, 0);
    assert.equal(registry.isDocumentLoaded(authored.documentId), false);
    assert.ok(consumers.every(consumer => consumer.fontFamilyResolver === undefined));
    assert.deepEqual(Font.enumerateFonts(false), []);
    await registry.dispose();
});

test("dispose fences pending document transactions and prevents later commit", async () => {
    const authored = entry("dispose-pending", 1, "regular", "dispose-pending");
    const harness = new FontHarness();
    const registry = new AuthoredFontRegistry(manifest([authored]));
    const control = deferred();
    harness.faceDeferred.set(registry.runtimeFamilyFor(keyOf(authored)), control);
    const pending = registry.preload(authored.documentId);
    let disposed = false;
    const disposing = registry.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    assert.equal(disposed, false, "dispose must wait for the pending platform transaction");
    await assert.rejects(registry.preload(authored.documentId), /registry is disposing/);
    control.resolve();
    await Promise.all([pending, disposing]);
    assert.equal(registry.isDocumentLoaded(authored.documentId), false);
    assert.equal(harness.installed.size, 0);
    assert.deepEqual(Font.enumerateFonts(false), []);
    await Promise.resolve();
    assert.equal(harness.installed.size, 0, "no commit may occur after dispose returns");
});

test("ordinary Loader options cannot mint an authenticated font receipt", async () => {
    const authored = entry("public-mint", 1, "regular", "public-mint");
    const harness = new FontHarness();
    await assert.rejects(Promise.resolve().then(() => harness.adapter.loadFont({
        url: authored.sourceUrl,
        options: {
            authoredFontFamily: "LayaAuthored_public_mint",
            authoredFontIdentity: "caller-selected-key",
            authoredFontSourceSha256: authored.sourceSha256,
        },
        progress: { createCallback: (): undefined => undefined },
        loader: { fetch: (url: string) => harness.fetch(url) },
    } as unknown as ILoadTask)), /requires an engine registry transaction/);
    assert.equal(harness.fetchCount.size, 0);
    assert.equal(harness.installed.size, 0);
    assert.equal((harness.adapter as any).createAuthenticatedReceipt, undefined);
    class ReceiptMintProbe extends FontAdapter {
        exposeMint(): unknown {
            // @ts-expect-error receipt construction is not a subclass surface
            return this.createAuthenticatedReceipt;
        }
    }
    assert.equal(new ReceiptMintProbe().exposeMint(), undefined);
});

test("raw SHA authenticates one fetched byte snapshot and rejects same-URL wrong bytes", async () => {
    const authored = entry("auth", 1, "regular", "expected");
    const expected = ASSETS.get(authored.sourceUrl)!;
    const harness = new FontHarness();
    harness.fetchSequences.set(authored.sourceUrl, [expected, bytes("toctou-replacement")]);
    const registry = new AuthoredFontRegistry(manifest([authored]));
    await registry.preload("auth");
    assert.equal(harness.fetchCount.get(authored.sourceUrl), 1, "verified bytes must be registered without refetch");
    assert.deepEqual(new Uint8Array(harness.faces[0].source), new Uint8Array(expected));
    const registeredSnapshot = new Uint8Array(harness.faces[0].source).slice();
    new Uint8Array(expected).fill(0xff);
    assert.deepEqual(new Uint8Array(harness.faces[0].source), registeredSnapshot,
        "transport-owned buffer mutation must not change authenticated registration bytes");
    await registry.dispose();

    const wrongHarness = new FontHarness();
    wrongHarness.fetchSequences.set(authored.sourceUrl, [bytes("wrong-at-same-url")]);
    const wrongRegistry = new AuthoredFontRegistry(manifest([authored]));
    await assert.rejects(wrongRegistry.preload("auth"), /do not match sourceSha256/);
    assert.equal(wrongHarness.installed.size, 0);
});

test("Flash Font authority is sealed, has exact glyph coverage, and invents no device fonts", async () => {
    const authored = entry("bridge", 9, "regular", "bridge");
    new FontHarness();
    const registry = new AuthoredFontRegistry(manifest([authored]));
    await registry.preload("bridge");
    assert.equal((Font as any)._fromEngine, undefined);
    assert.equal((Font as any)._installEngineRegistry, undefined);
    assert.equal((Font as any).installAuthenticatedFontRecords, undefined);
    assert.equal((Font as any).activateAuthenticatedFontRecords, undefined);
    if (false) {
        // @ts-expect-error public callers cannot mint Font instances
        Font._fromEngine({});
        // @ts-expect-error public callers cannot install a registry
        Font._installEngineRegistry({});
    }
    const lease = registry.activateFlashBridge();
    class BodyFont {
        static readonly authoredFont = Object.freeze({
            documentId: authored.documentId, fontId: authored.fontId,
            fontStyle: authored.fontStyle, sourceSha256: authored.sourceSha256,
        });
    }
    Font.registerFont(BodyFont);
    const fonts = Font.enumerateFonts(false);
    assert.deepEqual(fonts.map(font => [font.fontName, font.fontStyle, font.fontType]),
        [["Body", "regular", FontType.EMBEDDED]]);
    assert.equal(fonts[0].hasGlyphs(""), true);
    assert.equal(fonts[0].hasGlyphs("AV💮"), true);
    assert.equal(fonts[0].hasGlyphs("B"), false);
    assert.throws(() => fonts[0].hasGlyphs(7 as any), TypeError);
    assert.deepEqual(Font.enumerateFonts(true).map(font => font.fontName), ["Body"]);
    lease.cancel();
    assert.deepEqual(Font.enumerateFonts(true), []);
    await registry.dispose();
});

test("native authored loading fails closed when unregister is unavailable", async () => {
    const authored = entry("native", 1, "regular", "native");
    const previousGlobal = PAL.g;
    (PAL as any).g = { registerFont: () => assert.fail("must not register without rollback") };
    try {
        const native = new NativeFontAdapter();
        (ILaya as any).loader = {
            load: (options: Record<string, any>) => native.loadFont({
                url: options.url, options,
                loader: { fetch: async () => ASSETS.get(options.url) },
            } as unknown as ILoadTask),
        };
        const registry = new AuthoredFontRegistry(manifest([authored]));
        await assert.rejects(registry.preload("native"), /did not return an exact authenticated receipt/);
        assert.equal(registry.isDocumentLoaded("native"), false);
    } finally {
        (PAL as any).g = previousGlobal;
    }
});

test("dispose failure invalidates the entire document and permits a fresh retry", async () => {
    const authored = entry("dispose-retry", 1, "regular", "dispose-retry");
    const harness = new FontHarness();
    const registry = new AuthoredFontRegistry(manifest([authored]));
    await registry.preload("dispose-retry");
    const lease = registry.activateFlashBridge();
    const family = registry.runtimeFamilyFor(keyOf(authored));
    harness.rejectDisposeFamilies.add(family);
    await assert.rejects(registry.disposeDocument("dispose-retry"), /platform dispose rejected/);
    assert.equal(registry.isDocumentLoaded("dispose-retry"), false);
    assert.deepEqual(Font.enumerateFonts(false), []);
    lease.cancel();
    harness.rejectDisposeFamilies.clear();
    await registry.preload("dispose-retry");
    assert.equal(registry.isDocumentLoaded("dispose-retry"), true);
    await registry.dispose();
});

test("font startup catalogs own integrity, preload order and ApplicationDomain definitions", async () => {
    assert.equal(
        authoredFontCatalogUrlForDirectory("/Resources/en_Eu/Swf/Font/"),
        "/Resources/en_Eu/Swf/Font/runtime-font-catalog.json",
    );
    assert.throws(() => authoredFontCatalogUrlForDirectory("/Resources/en_Eu/Swf/Font"), /end with/);
    const authored = entry("catalog-font", 3, "regular", "catalog-font");
    new FontHarness();
    const manifestBytes = jsonBytes(manifest([authored]));
    const manifestReference = reference("/authored/fonts/manifest.json", manifestBytes);
    const startupBytes = jsonBytes({
        schema: "laya-authored-font-startup@1",
        manifest: manifestReference,
        preloadOrder: [authored.documentId],
        definitions: [{
            className: "FontCatalogBody",
            fontName: authored.fontName,
            authoredFont: keyOf(authored),
        }],
    });
    const startupReference = reference("/authored/fonts/startup.json", startupBytes);
    const responses = new Map([
        [startupReference.url, startupBytes],
        [manifestReference.url, manifestBytes],
    ]);
    let fetchCount = 0;
    const fetcher = async (url: string) => {
        fetchCount += 1;
        const body = responses.get(url);
        return { ok: body !== undefined, status: body === undefined ? 404 : 200, async arrayBuffer() { return body!; } };
    };
    const domain = new ApplicationDomain();
    const activation = await activateAuthoredFontCatalog(startupReference, {
        applicationDomain: domain,
        fetch: fetcher,
        digest: webcrypto.subtle,
    });
    assert.equal(fetchCount, 2);
    assert.equal(domain.hasDefinition("FontCatalogBody"), true);
    const definition = domain.getDefinition("FontCatalogBody") as unknown as Parameters<typeof Font.registerFont>[0];
    assert.equal(Object.prototype.hasOwnProperty.call(definition, "authoredFont"), true);
    assert.deepEqual(definition.authoredFont, keyOf(authored));
    Font.registerFont(definition);
    assert.deepEqual(Font.enumerateFonts(true).map(font => font.fontName), ["Body"]);

    const repeated = await activateAuthoredFontCatalog(startupReference, {
        applicationDomain: domain,
        fetch: fetcher,
        digest: webcrypto.subtle,
    });
    assert.equal(repeated, activation);
    assert.equal(fetchCount, 2);
    await activation.dispose();
    assert.deepEqual(Font.enumerateFonts(true), []);

    const loadedDomain = new ApplicationDomain();
    const loaded = await loadAndActivateAuthoredFontCatalog(startupReference.url, {
        applicationDomain: loadedDomain,
        fetch: fetcher,
        digest: webcrypto.subtle,
    });
    assert.equal(fetchCount, 4, "URL loading fetches the startup once and its authenticated manifest once");
    assert.equal(loadedDomain.hasDefinition("FontCatalogBody"), true);
    assert.deepEqual(loaded.startup, activation.startup);
    await loaded.dispose();
});

test("font startup catalogs fail closed on descriptor integrity drift", async () => {
    new FontHarness();
    const bytes = jsonBytes({ invalid: true });
    const pinned = { ...reference("/authored/fonts/invalid.json", bytes), sha256: "0".repeat(64) };
    await assert.rejects(activateAuthoredFontCatalog(pinned, {
        applicationDomain: new ApplicationDomain(),
        fetch: async () => ({ ok: true, status: 200, async arrayBuffer() { return bytes; } }),
        digest: webcrypto.subtle,
    }), /SHA-256 mismatch/);
});
