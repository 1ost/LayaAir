import assert from "node:assert/strict";
import test from "node:test";

import {
    AuthoredFontBindingCancelledError,
    AuthoredFontRegistry,
    type AuthoredFontLoadPort,
    type AuthoredFontManifest,
    type AuthoredFontManifestEntry,
} from "../../src/extensions/authoredContent/runtime/AuthoredFontRegistry";
import { Font } from "../../src/layaAir/flash/text/Font";
import { FontType } from "../../src/layaAir/flash/text/FontType";
import { TextField } from "../../src/layaAir/flash/text/TextField";
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
(Render2DProcessor as unknown as { runner: unknown }).runner = {
    _textRender: { getFontHeight: (): number => 10 },
};
Browser.context = {
    font: "10px Arial",
    fontKerning: "normal",
    measureText: (value: string) => ({ width: Array.from(value).length * 5 }),
} as unknown as CanvasRenderingContext2D;
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;
ILaya.timer = { callLater: (): void => undefined } as any;
ILaya.systemTimer = { callLater: (): void => undefined, runCallLater: (): void => undefined } as any;
(PAL as any).textInput = {
    target: null,
    begin(target: unknown): void { this.target = target; },
    end(): void { this.target = null; },
    setText: (): void => undefined,
    setSelection: (): void => undefined,
    syncSelection: (): void => undefined,
    syncText: (): void => undefined,
};
(PAL as any).browser ??= { on: (): void => undefined };

const GLYPHS = Object.freeze([
    Object.freeze({ codePoint: 0x20, advance: 250 }),
    Object.freeze({ codePoint: 0x41, advance: 600 }),
    Object.freeze({ codePoint: 0x56, advance: 620 }),
    Object.freeze({ codePoint: 0x1f4ae, advance: 1000 }),
]);

function entry(
    documentId: string,
    fontId: number,
    fontStyle: AuthoredFontManifestEntry["fontStyle"],
    sourceCharacter: string,
    overrides: Partial<AuthoredFontManifestEntry> = {},
): AuthoredFontManifestEntry {
    return {
        documentId,
        fontId,
        fontName: "Body",
        fontStyle,
        fontType: "embedded",
        sourceSha256: sourceCharacter.repeat(64),
        sourceUrl: `fonts/${documentId}-${fontId}-${fontStyle}.woff2`,
        unitsPerEm: 1000,
        ascent: 800,
        descent: 200,
        glyphs: GLYPHS,
        ...overrides,
    };
}

function manifest(fonts: readonly AuthoredFontManifestEntry[]): AuthoredFontManifest {
    return { schema: "laya-authored-font-manifest@1", fonts };
}

class RecordingLoader implements AuthoredFontLoadPort {
    readonly requests: Array<{ entry: AuthoredFontManifestEntry; runtimeFamily: string }> = [];
    failUrl: string | null = null;

    async load(entry: AuthoredFontManifestEntry, runtimeFamily: string) {
        this.requests.push({ entry, runtimeFamily });
        return entry.sourceUrl === this.failUrl ? null : { family: runtimeFamily };
    }
}

class DeferredLoader implements AuthoredFontLoadPort {
    private complete: (() => void) | null = null;

    load(_entry: AuthoredFontManifestEntry, runtimeFamily: string): Promise<{ family: string }> {
        return new Promise(resolve => { this.complete = () => resolve({ family: runtimeFamily }); });
    }

    resolve(): void {
        assert.ok(this.complete, "a font load must be pending");
        this.complete();
    }
}

test("manifest ownership is immutable and same-named documents receive collision-safe families", async () => {
    const alpha = entry("document-alpha", 7, "regular", "a");
    const beta = entry("document-beta", 7, "regular", "b");
    const source = manifest([alpha, beta]);
    const loader = new RecordingLoader();
    const registry = new AuthoredFontRegistry(source, { loader });

    (alpha as { fontName: string }).fontName = "mutated";
    (source.fonts as AuthoredFontManifestEntry[]).length = 0;
    assert.equal(registry.manifest.fonts.length, 2);
    assert.equal(registry.manifest.fonts[0].fontName, "Body");
    assert.equal(Object.isFrozen(registry.manifest), true);
    assert.equal(Object.isFrozen(registry.manifest.fonts[0].glyphs), true);

    await Promise.all([registry.preload("document-alpha"), registry.preload("document-beta")]);
    assert.equal(loader.requests.length, 2);
    assert.notEqual(loader.requests[0].runtimeFamily, loader.requests[1].runtimeFamily);
    assert.match(loader.requests[0].runtimeFamily, /^LayaAuthored_[A-Za-z0-9_-]+$/);
    assert.notEqual(registry.runtimeFamilyFor({
        documentId: "document-alpha", fontId: 7, fontStyle: "regular", sourceSha256: "a".repeat(64),
    }), registry.runtimeFamilyFor({
        documentId: "document-beta", fontId: 7, fontStyle: "regular", sourceSha256: "b".repeat(64),
    }));

    assert.throws(() => new AuthoredFontRegistry(manifest([
        entry("ambiguous", 1, "regular", "c"),
        entry("ambiguous", 2, "regular", "d"),
    ]), { loader }), /Ambiguous authored font selection/);
});

test("style selection binds exact metrics and glyph advances to canonical Text and TextField seams", async () => {
    const fonts = [
        entry("styled", 1, "regular", "1"),
        entry("styled", 2, "bold", "2", { ascent: 810, descent: 190 }),
        entry("styled", 3, "italic", "3", { ascent: 790, descent: 210 }),
        entry("styled", 4, "boldItalic", "4", { ascent: 820, descent: 180 }),
    ];
    const registry = new AuthoredFontRegistry(manifest(fonts), { loader: new RecordingLoader() });
    await registry.preload("styled");

    for (const consumer of [new Text(), new TextField()]) {
        const binding = registry.bindText(consumer, "styled");
        const regular = consumer.fontFamilyResolver("Body", false, false);
        const bold = consumer.fontFamilyResolver("Body", true, false);
        const italic = consumer.fontFamilyResolver("Body", false, true);
        const boldItalic = consumer.fontFamilyResolver("Body", true, true);
        assert.equal(new Set([regular, bold, italic, boldItalic]).size, 4);
        assert.deepEqual(consumer.fontMetricsProvider("Body", 12, false, false), { ascent: 9.6, descent: 2.4 });
        assert.deepEqual(consumer.fontMetricsProvider("Body", 10, true, false), { ascent: 8.1, descent: 1.9 });
        assert.deepEqual(consumer.textAdvanceProvider("AV💮", "Body", 10, false, false, true), [6, 6.2, 10]);
        assert.throws(() => consumer.textAdvanceProvider("B", "Body", 10, false, false, true),
            /no declared glyph U\+42/);
        assert.throws(() => consumer.fontFamilyResolver("Missing", false, false), /device fallback is not permitted/);
        binding.cancel();
        assert.equal(binding.active, false);
        consumer.destroy();
    }
});

test("a failed document preload publishes no partial registry state and remains retryable", async () => {
    const first = entry("atomic", 1, "regular", "5");
    const second = entry("atomic", 2, "bold", "6");
    const loader = new RecordingLoader();
    loader.failUrl = second.sourceUrl;
    const registry = new AuthoredFontRegistry(manifest([first, second]), { loader });

    await assert.rejects(registry.preload("atomic"), /did not publish collision-safe family/);
    assert.equal(registry.isDocumentLoaded("atomic"), false);
    assert.deepEqual(registry.enumerateFonts(false), []);
    assert.throws(() => registry.bindText(new Text(), "atomic"), /must be preloaded/);

    loader.failUrl = null;
    const records = await registry.preload("atomic");
    assert.equal(records.length, 2);
    assert.equal(registry.isDocumentLoaded("atomic"), true);
    assert.equal(registry.enumerateFonts(false).length, 2);
});

test("destroyed and cancelled consumers never receive providers after async preload", async () => {
    const destroyedLoader = new DeferredLoader();
    const destroyedRegistry = new AuthoredFontRegistry(manifest([
        entry("destroyed", 1, "regular", "7"),
    ]), { loader: destroyedLoader });
    const field = new TextField();
    const destroyedBinding = destroyedRegistry.preloadAndBind(field, "destroyed");
    field.destroy();
    destroyedLoader.resolve();
    await assert.rejects(destroyedBinding, AuthoredFontBindingCancelledError);
    assert.equal(field.fontFamilyResolver, undefined);

    const cancelledLoader = new DeferredLoader();
    const cancelledRegistry = new AuthoredFontRegistry(manifest([
        entry("cancelled", 1, "regular", "8"),
    ]), { loader: cancelledLoader });
    const text = new Text();
    const controller = new AbortController();
    const cancelledBinding = cancelledRegistry.preloadAndBind(text, "cancelled", controller.signal);
    controller.abort();
    cancelledLoader.resolve();
    await assert.rejects(cancelledBinding, AuthoredFontBindingCancelledError);
    assert.equal(text.fontFamilyResolver, undefined);
    text.destroy();
});

test("Flash Font enumerates only loaded embedded fonts plus an explicit device snapshot", async () => {
    const authored = entry("bridge", 9, "regular", "9");
    const registry = new AuthoredFontRegistry(manifest([authored]), { loader: new RecordingLoader() });
    await registry.preload("bridge");
    const lease = registry.activateFlashBridge();
    class BodyFont {
        static readonly authoredFont = Object.freeze({
            documentId: "bridge", fontId: 9, fontStyle: "regular", sourceSha256: "9".repeat(64),
        } as const);
    }
    Font.registerFont(BodyFont);
    assert.deepEqual(Font.enumerateFonts(false).map(font => [font.fontName, font.fontStyle, font.fontType]),
        [["Body", "regular", FontType.EMBEDDED]]);
    assert.deepEqual(Font.enumerateFonts(true).map(font => font.fontName), ["Body"],
        "the browser policy must not invent device fonts");
    lease.cancel();
    assert.deepEqual(Font.enumerateFonts(true), []);
    assert.throws(() => Font.registerFont(BodyFont), /requires an active authored font registry/);

    const explicit = new AuthoredFontRegistry(manifest([
        entry("device-policy", 1, "regular", "a"),
    ]), {
        loader: new RecordingLoader(),
        deviceFonts: [{ fontName: "Arial", fontStyle: "regular" }],
    });
    await explicit.preload("device-policy");
    const explicitLease = explicit.activateFlashBridge();
    assert.deepEqual(Font.enumerateFonts(false).map(font => font.fontName), ["Body"]);
    assert.deepEqual(Font.enumerateFonts(true).map(font => [font.fontName, font.fontType]),
        [["Body", FontType.EMBEDDED], ["Arial", FontType.DEVICE]]);
    explicitLease.cancel();
});

test("normal Laya font adapters accept only collision-safe requests and cleanly report load failure", async () => {
    class ProbeAdapter extends FontAdapter {
        family(options: Record<string, unknown>): string {
            return this.resolveFamily({
                url: "fonts/body.ttf",
                options,
            } as ILoadTask);
        }

        face(task: ILoadTask, url: string, family: string) {
            return this.loadByFontFace(task, url, family);
        }
    }
    const adapter = new ProbeAdapter();
    assert.equal(adapter.family({}), "body");
    assert.equal(adapter.family({ authoredFontFamily: "LayaAuthored_ZG9j_1_regular_" + "a".repeat(64) }),
        "LayaAuthored_ZG9j_1_regular_" + "a".repeat(64));
    assert.throws(() => adapter.family({ authoredFontFamily: "bad family';src:url(evil)" }),
        /collision-safe Laya authored family/);

    const faces = new Set<unknown>();
    const previousFontFace = Browser.window.FontFace;
    const previousFonts = Browser.document.fonts;
    Browser.window.FontFace = class {
        load(): Promise<never> { return Promise.reject(new Error("font rejected")); }
    } as any;
    Object.defineProperty(Browser.document, "fonts", {
        configurable: true,
        value: { add: (face: unknown) => faces.add(face), delete: (face: unknown) => faces.delete(face) },
    });
    try {
        await assert.rejects(adapter.face({} as ILoadTask, "fonts/body.ttf", "LayaAuthored_safe"), /font rejected/);
        assert.equal(faces.size, 0, "a rejected FontFace must not remain installed");
    } finally {
        Browser.window.FontFace = previousFontFace;
        Object.defineProperty(Browser.document, "fonts", { configurable: true, value: previousFonts });
    }

    const previousGlobal = PAL.g;
    (PAL as any).g = { registerFont: () => assert.fail("a missing native font must not be registered") };
    try {
        const native = new NativeFontAdapter();
        const result = await native.loadFont({
            url: "fonts/body.ttf",
            options: { authoredFontFamily: "LayaAuthored_safe" },
            loader: { fetch: async (): Promise<null> => null },
        } as unknown as ILoadTask);
        assert.equal(result, null);
    } finally {
        (PAL as any).g = previousGlobal;
    }
});
