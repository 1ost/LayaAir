import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { Byte } from "../../src/layaAir/laya/utils/Byte";
import { ILaya } from "../../src/layaAir/ILaya";
import { Keyframe2D } from "../../src/layaAir/laya/components/KeyFrame2D";
import { KeyframeNode2D } from "../../src/layaAir/laya/components/KeyframeNode2D";
import { KeyframeNodeList2D } from "../../src/layaAir/laya/components/KeyframeNodeList2D";
import { Matrix } from "../../src/layaAir/laya/maths/Matrix";
import { XML } from "../../src/layaAir/laya/html/XML";
import { SwfXmlSourceAdapter } from "../../src/extensions/authoredContent/offlineAdapters/SwfXmlSourceAdapter";
import { XflBundleSourceAdapter } from "../../src/extensions/authoredContent/offlineAdapters/XflBundleSourceAdapter";
import { FlashLibrarySymbolAdapter } from "../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter";
import { normalizeNeutralAuthoredContent } from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR";
import { NativeAnimationClip2DWriter } from "../../src/extensions/authoredContent/emit/NativeAnimationClip2DWriter";
import { NativeLayaEmitter } from "../../src/extensions/authoredContent/emit/NativeLayaEmitter";
import {
    NativeAssetImporterTransaction,
    NativeAssetTransactionEvent,
    NativeAssetTransactionHost,
    listNativeAssetImporterRecoveryPaths,
    retireAbortedNativeAssetImporterPublication,
    resumeNativeAssetImporterRecovery,
    retireNativeAssetImporterRecovery
} from "../../src/extensions/authoredContent/emit/NativeAssetImporterTransaction";
import {
    captureEditorSubAssetState,
    EditorSubAssetIdentity,
    restoreEditorSubAssetState
} from "../../src/extensions/authoredContent/emit/EditorSubAssetState";
import {
    prepareNativeLayaHierarchy,
    prepareNativeLayaAuthoredContentBundle,
    writeNativeLayaAuthoredContentTransaction
} from "../../src/extensions/authoredContent/emit/NativeLayaHierarchyWriter";
const { runIdeHierarchyRoundTrip } = require("./ideHierarchyRoundTrip.cjs") as {
    runIdeHierarchyRoundTrip(
        content: ReturnType<typeof normalizeNeutralAuthoredContent>,
        emitter: typeof NativeLayaEmitter,
        writer: typeof NativeAnimationClip2DWriter,
        bitmapContent?: ReturnType<typeof normalizeNeutralAuthoredContent>,
        hierarchyWriter?: typeof prepareNativeLayaHierarchy
    ): void;
};

class TestSprite {
    name = "";
    x = 0;
    y = 0;
    width = 0;
    height = 0;
    alpha = 1;
    visible = true;
    zOrder = 0;
    readonly children: TestSprite[] = [];
    readonly components: unknown[] = [];
    addChild<T extends TestSprite>(child: T): T { this.children.push(child); return child; }
    getChildAt(index: number): TestSprite { return this.children[index]; }
    addComponent<T>(Component: new () => T): T {
        const component = new Component();
        this.components.push(component);
        return component;
    }
    getComponent<T>(Component: new () => T): T | null {
        return this.components.find(value => value instanceof Component) as T ?? null;
    }
    destroy(): void { this.children.length = 0; }
}
class TestText extends TestSprite {
    text = "";
    fontSize = 12;
    color = "#000000";
}
class TestImage extends TestSprite {
    _skin = "";
    get skin(): string { return this._skin; }
    set skin(value: string) { this._skin = value; }
}
class TestAnimatorClip2D {
    clip?: AnimationClip2D;
    autoPlay = false;
}

(globalThis as any).Laya = {
    AnimationClip2D,
    AnimatorClip2D: TestAnimatorClip2D,
    Byte,
    Image: TestImage,
    Keyframe2D,
    KeyframeNode2D,
    KeyframeNodeList2D,
    Matrix,
    Sprite: TestSprite,
    Text: TestText,
    XML
};
(ILaya as any).loader = { clearRes() {} };

let passed = 0;

async function test(name: string, run: () => void | Promise<void>): Promise<void> {
    await run();
    passed++;
    console.log(`ok ${passed} - ${name}`);
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}

function sourceDocument(): Record<string, unknown> {
    return {
        schema: "neutral-authored-content@1",
        documentId: "sample-ui",
        root: {
            linkage: "Root",
            kind: "container",
            width: 200,
            height: 100,
            children: [{
                linkage: "Title",
                name: "titleField",
                kind: "text",
                x: 10,
                y: 12,
                text: "Hello",
                fontSize: 18,
                color: "#ffffff",
                children: []
            }]
        },
        timeline: {
            frameRate: 24,
            duration: 1,
            loop: true,
            tracks: [{
                targetPath: ["Root", "Title"],
                property: "x",
                keyframes: [
                    { time: 1, value: 50 },
                    { time: 0, value: 10, tweenType: "Linear" }
                ]
            }]
        }
    };
}

function bitmapHierarchyDocument(payload: Uint8Array): Record<string, unknown> {
    return {
        schema: "neutral-authored-content@1",
        documentId: "bitmap-hierarchy",
        resources: [{
            id: "hero",
            sourcePath: "images/hero.png",
            mediaType: "image/png",
            byteLength: payload.byteLength,
            sha256: sha256(payload)
        }],
        root: {
            linkage: "Root",
            kind: "container",
            x: 1,
            y: 2,
            width: 100,
            height: 50,
            alpha: 0.9,
            visible: false,
            children: [{
                linkage: "Front",
                name: "frontLayer",
                kind: "container",
                depth: 20,
                children: []
            }, {
                linkage: "Nested",
                name: "nestedSymbol",
                kind: "container",
                depth: 10,
                x: 3,
                y: 4,
                width: 64,
                height: 32,
                alpha: 0.8,
                visible: false,
                children: [{
                    linkage: "HeroBitmap",
                    name: "heroImage",
                    kind: "image",
                    depth: 7,
                    resourceId: "hero",
                    x: 4,
                    y: 5,
                    width: 32,
                    height: 16,
                    alpha: 0.75,
                    visible: false,
                    children: []
                }]
            }]
        },
        timeline: { frameRate: 30, duration: 0, loop: false, tracks: [] }
    };
}

function dynamicTextDocument(): Record<string, unknown> {
    return {
        schema: "neutral-authored-content@1",
        documentId: "bootstrap-loading",
        resources: [],
        root: {
            linkage: "symbol21",
            runtimeLinkage: "Processors_Mini.Accessories.LoadingScreenSkin",
            kind: "container",
            width: 1250,
            height: 650,
            children: [{
                linkage: "symbol17",
                name: "TF_ProgressText",
                kind: "dynamic-text",
                variable: true,
                depth: 7,
                x: 347.1,
                y: 558,
                width: 574.85,
                height: 22.45,
                textField: {
                    sourceId: 17,
                    type: "dynamic",
                    multiline: false,
                    wordWrap: false,
                    selectable: false,
                    displayAsPassword: false,
                    autoSize: "none",
                    html: false,
                    filters: [],
                    gutter: 2,
                    overflow: "hidden",
                    initialText: "",
                    format: {
                        fontMode: "device",
                        font: "Arial",
                        size: 14,
                        color: 0xffffff,
                        bold: true,
                        italic: false,
                        underline: false,
                        align: "center",
                        leftMargin: 0,
                        rightMargin: 0,
                        indent: 0,
                        leading: 2,
                    },
                },
                children: [],
            }],
        },
        timeline: { frameRate: 30, duration: 0, loop: false, tracks: [] },
    };
}

function nestedHappyBearDocument(): Record<string, unknown> {
    const resources = [1, 5, 9, 13].map(frame => ({
        id: `happy-frame-${frame}`,
        sourcePath: `images/happy-frame-${frame}.png`,
        mediaType: "image/png",
        byteLength: 1,
        sha256: "00".repeat(32),
    }));
    const children = [1, 5, 9, 13].map((frame, index) => ({
        linkage: `pose${frame}`,
        name: `pose${frame}`,
        kind: "image",
        depth: index + 1,
        resourceId: `happy-frame-${frame}`,
        visible: frame === 1,
        children: [],
    }));
    return {
        schema: "neutral-authored-content@1",
        documentId: "bootstrap-happy-bear",
        resources,
        root: {
            linkage: "symbol21",
            kind: "container",
            children: [{
                linkage: "symbol11",
                name: "HappyBear",
                kind: "container",
                depth: 1,
                children,
                timeline: {
                    frameRate: 30,
                    duration: 16 / 30,
                    loop: true,
                    tracks: children.map(child => ({
                        targetPath: ["symbol11", child.linkage],
                        property: "visible",
                        keyframes: [1, 5, 9, 13].map(frame => ({
                            time: (frame - 1) / 30,
                            value: child.linkage === `pose${frame}`,
                        })),
                    })),
                },
            }],
        },
        timeline: { frameRate: 30, duration: 0, loop: false, tracks: [] },
    };
}

function labeledMovieClipDocument(): Record<string, unknown> {
    return {
        schema: "neutral-authored-content@1",
        documentId: "labeled-button",
        resources: [],
        root: {
            linkage: "Root",
            runtimeLinkage: "fixtures.LabeledRoot",
            kind: "container",
            width: 100,
            height: 80,
            children: [{
                linkage: "ButtonStates",
                name: "Btn_Activate",
                kind: "container",
                depth: 1,
                width: 20,
                height: 10,
                children: [],
                timeline: {
                    frameRate: 24,
                    duration: 4 / 24,
                    loop: true,
                    frameLabels: { up: 1, over: 2, down: 3, disabled: 4 },
                    tracks: [],
                },
            }],
        },
        timeline: {
            frameRate: 24,
            duration: 1 / 24,
            loop: false,
            frameLabels: { ready: 1 },
            tracks: [],
        },
    };
}

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function bitmapNativeHierarchy(): Record<string, any> {
    return {
        name: "Root",
        "_$ver": 1,
        "_$type": "Sprite",
        x: 1,
        y: 2,
        width: 100,
        height: 50,
        alpha: 0.9,
        visible: false,
        "_$child": [{
            zOrder: 10,
            name: "nestedSymbol",
            "_$type": "Sprite",
            x: 3,
            y: 4,
            width: 64,
            height: 32,
            alpha: 0.8,
            visible: false,
            "_$child": [{
                skin: "res://hero-asset",
                zOrder: 7,
                name: "heroImage",
                "_$type": "Image",
                x: 4,
                y: 5,
                width: 32,
                height: 16,
                alpha: 0.75,
                visible: false
            }]
        }, {
            zOrder: 20,
            name: "frontLayer",
            "_$type": "Sprite"
        }]
    };
}

function bitmapBundlePreparation(payload: Uint8Array) {
    return {
        content: normalizeNeutralAuthoredContent(bitmapHierarchyDocument(payload)),
        hierarchy: bitmapNativeHierarchy(),
        prefabPath: "bitmap-hierarchy.lh",
        timelinePath: "bitmap-hierarchy.mc",
        timelineAssetId: "timeline-asset",
        timelineBytes: new Uint8Array([7, 8, 9]),
        resourceAssetIds: new Map([["hero", "hero-asset"]]),
        resourcePayloads: new Map([["hero", payload]]),
        sha256
    };
}

const nativeTransactionHost: NativeAssetTransactionHost = {
    fs: fs as unknown as NativeAssetTransactionHost["fs"],
    path,
    sha256
};

function journalPublicationFaultHost(fault: "write" | "schema-only" | "sync" | "rename" | "directory-sync"): NativeAssetTransactionHost {
    return {
        ...nativeTransactionHost,
        fs: {
            ...nativeTransactionHost.fs,
            promises: {
                ...nativeTransactionHost.fs.promises,
                async open(file, flags) {
                    const handle = await (fs.promises.open(file, flags as any));
                    if (fault === "directory-sync" && file.endsWith("authored-content-native-transaction")) return {
                        async writeFile(bytes: Uint8Array | string) { await handle.writeFile(bytes); },
                        async sync() { throw new Error("simulated journal directory fsync interruption"); },
                        async close() { await handle.close(); }
                    };
                    if (!file.endsWith("recovery.next.json")) return handle as any;
                    return {
                        async writeFile(bytes: Uint8Array | string) {
                            if (fault === "write") {
                                await handle.writeFile("{");
                                throw new Error("simulated journal write interruption");
                            }
                            if (fault === "schema-only") {
                                await handle.writeFile('{"schema":"laya-authored-content-recovery@2"}');
                                throw new Error("simulated journal schema-only interruption");
                            }
                            await handle.writeFile(bytes);
                        },
                        async sync() {
                            if (fault === "sync")
                                throw new Error("simulated journal fsync interruption");
                            await handle.sync();
                        },
                        async close() { await handle.close(); }
                    };
                },
                async rename(source, destination) {
                    if (fault === "rename" && source.endsWith("recovery.next.json"))
                        throw new Error("simulated journal rename interruption");
                    await fs.promises.rename(source, destination);
                }
            }
        }
    };
}

async function main(): Promise<void> {
    await test("XFL bundle adapter validates and scales immutable manifest content", () => {
        const adapter = new XflBundleSourceAdapter();
        const content = adapter.parseText(JSON.stringify({ format: "xflbundle@1", content: sourceDocument() }), { scale: 2 });
        assert(content.root.width === 400, "root width was not scaled");
        assert(content.root.children[0].x === 20, "child position was not scaled");
        assert(content.timeline.tracks[0].keyframes[0].time === 0, "keyframes were not sorted");
        assert(content.timeline.tracks[0].keyframes[0].value === 20, "track value was not scaled");
    });

    await test("SWF XML adapter produces the same validated neutral IR", () => {
        const xml = [
            '<swf-authored-content version="1" id="sample-ui">',
            '  <node linkage="Root" kind="container" width="200" height="100">',
            '    <node linkage="Title" kind="text" x="10" y="12" text="Hello" fontSize="18" color="#ffffff"/>',
            '  </node>',
            '  <timeline frameRate="24" duration="1" loop="true">',
            '    <track target="Root/Title" property="x">',
            '      <key time="0" value="10" tween="Linear"/>',
            '      <key time="1" value="50"/>',
            '    </track>',
            '  </timeline>',
            '</swf-authored-content>'
        ].join("\n");
        const content = new SwfXmlSourceAdapter().parseText(xml);
        assert(content.documentId === "sample-ui", "document ID was not parsed");
        assert(content.root.children[0].text === "Hello", "text node was not parsed");
        assert(content.timeline.tracks[0].keyframes[1].value === 50, "timeline was not parsed");
    });

    await test("authenticated image resources and authored depth normalize into exact nested hierarchy order", () => {
        const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
        const content = normalizeNeutralAuthoredContent(bitmapHierarchyDocument(payload));
        assert(content.resources.length === 1, "image resource closure was lost");
        assert(content.resources[0].outputPath === "resources/hero.png", "image output path is not canonical");
        assert(content.root.children.map(child => child.name).join(",") === "nestedSymbol,frontLayer", "children were not ordered by exact authored depth");
        assert(content.root.children[0].depth === 10, "authored parent depth was lost");
        assert(content.root.children[0].children[0].depth === 7, "nested authored depth was lost");
        assert(content.root.children[0].children[0].resourceId === "hero", "nested bitmap binding was lost");
    });

    await test("SWF XML adapter carries authenticated image identity without resource bytes", () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const xml = [
            '<swf-authored-content version="1" id="bitmap">',
            '  <resources>',
            `    <resource id="hero" sourcePath="images/hero.png" mediaType="image/png" byteLength="4" sha256="${sha256(payload)}"/>`,
            '  </resources>',
            '  <node linkage="Root" kind="container">',
            '    <node linkage="Hero" name="heroImage" kind="image" depth="5" resourceId="hero" width="4" height="4"/>',
            '  </node>',
            '  <timeline frameRate="30" duration="0" loop="false"/>',
            '</swf-authored-content>'
        ].join("\n");
        const content = new SwfXmlSourceAdapter().parseText(xml);
        assert(content.resources[0].sha256 === sha256(payload), "resource hash identity was not parsed");
        assert(content.root.children[0].kind === "image", "native image node was not parsed");
        assert(content.root.children[0].name === "heroImage", "image instance name was not parsed");
    });

    await test("bitmap hierarchy fails closed on ambiguous depth, resource closure, and undeclared fields", () => {
        const payload = new Uint8Array([1, 2, 3]);
        const mixed = bitmapHierarchyDocument(payload) as any;
        delete mixed.root.children[0].depth;
        assertThrows(() => normalizeNeutralAuthoredContent(mixed), "AUTHORED_CONTENT_MIXED_DEPTH_AUTHORITY");

        const unknown = bitmapHierarchyDocument(payload) as any;
        unknown.root.children[1].children[0].resourceId = "missing";
        assertThrows(() => normalizeNeutralAuthoredContent(unknown), "AUTHORED_CONTENT_IMAGE_RESOURCE_UNKNOWN");

        const unused = bitmapHierarchyDocument(payload) as any;
        unused.resources.push({ ...unused.resources[0], id: "unused", sourcePath: "images/unused.png" });
        assertThrows(() => normalizeNeutralAuthoredContent(unused), "AUTHORED_CONTENT_RESOURCE_UNREFERENCED");

        const undeclared = bitmapHierarchyDocument(payload) as any;
        undeclared.root.children[0].cacheAs = "bitmap";
        assertThrows(() => normalizeNeutralAuthoredContent(undeclared), "AUTHORED_CONTENT_FIELD_UNSUPPORTED");
    });

    await test("native emitter creates real Image nodes with exact depth, ordering, and resource identity", () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const content = normalizeNeutralAuthoredContent(bitmapHierarchyDocument(payload));
        const clip = NativeLayaEmitter.createTimeline(content);
        const root = NativeLayaEmitter.createPrefabRoot(content, "timeline-asset", clip, new Map([["hero", "hero-asset"]]));
        try {
            assert(root.getChildAt(0).name === "nestedSymbol", "native child order did not follow authored depth");
            assert(root.getChildAt(0).zOrder === 10, "native parent zOrder lost authored depth");
            const image = root.getChildAt(0).getChildAt(0);
            assert(image instanceof TestImage, "bitmap did not emit through the native Laya.Image seam");
            assert(image.name === "heroImage", "native image instance name was lost");
            assert(image.zOrder === 7, "native nested image depth was lost");
            assert(image.skin === "res://hero-asset", "native image resource binding was lost");
        }
        finally {
            root.destroy();
            clip.destroy();
        }
    });

    await test("dynamic TextField hierarchy emits canonical Laya-owned runtime binding and exact configuration", () => {
        const content = normalizeNeutralAuthoredContent(dynamicTextDocument());
        const hierarchy = prepareNativeLayaHierarchy(content, {
            "_$ver": 1,
            "_$type": "Sprite",
            name: "symbol21",
            width: 1250,
            height: 650,
            "_$child": [{
                "_$type": "Text",
                name: "TF_ProgressText",
                x: 347.1,
                y: 558,
                width: 574.85,
                height: 22.45,
            }],
        }, "root-timeline", new Map());
        const field = (hierarchy._$child as any[])[0];
        assert(hierarchy._$runtime === "Processors_Mini.Accessories.LoadingScreenSkin",
            "application root linkage was not emitted");
        assert(field._$type === "Sprite", "dynamic TextField serialized type is not canonical Sprite");
        assert(field._$runtime === "Laya.AuthoredContent.TextField",
            "dynamic TextField did not use the Laya-owned primitive runtime");
        assert(field._$var === true, "named application field was not marked for runtime injection");
        assert(field.authoredConfiguration.sourceId === 17, "dynamic TextField source identity was lost");
        assert(field.authoredConfiguration.format.font === "Arial", "dynamic TextField font was lost");
        assert(field.authoredConfiguration.format.bold === true, "dynamic TextField font style was lost");
    });

    await test("Flash zero-glyph DefineFont3 outline selectors use the authenticated device face and reject partial fonts", () => {
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 100, height: 40, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "Root", bounds: { x: 0, y: 0, width: 100, height: 40 } },
                "2": { characterId: 2, kind: "input-text", initialText: "", bounds: { x: 0, y: 0, width: 100, height: 30 },
                    textField: {
                        align: "center", autoSize: false, border: false, color: { alpha: 1, color: 0xffffff },
                        fieldType: "dynamic", fontId: 3, fontSize: 20, html: false, indent: 0, initialText: "",
                        leading: 0, leftMargin: 0, multiline: false, password: false, rightMargin: 0,
                        selectable: false, useOutlines: true, variableName: "", wordWrap: false,
                    } },
                "3": { characterId: 3, kind: "font", sourceTag: "DefineFont3Tag", font: {
                    ascent: 0, bold: true, descent: 0, embedded: false, family: "Microsoft YaHei Bold",
                    glyphCount: 0, glyphs: [], hasLayout: false, italic: false, kerning: [], leading: 0,
                    unitsPerEm: 20480,
                }, fontAlignZones: {
                    fontId: 3, sourceTag: "DefineFontAlignZonesTag", tableHint: 1, tableHintName: "medium", zones: [],
                } },
            },
        };
        const timelines = new Map([[1, {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "Root", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: [{
                op: "place", characterId: 2, depth: 1, move: false, ratio: 0, name: "TF_Value",
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            }], labels: [], sounds: [] }],
        }]]);
        const request = { library, timelines, entrySymbolId: 1, runtimeLinkage: "Root", resources: new Map() };
        const content = new FlashLibrarySymbolAdapter().parse(request);
        assert(content.root.children[0].textField?.format.fontMode === "device",
            "zero-glyph DefineFont3 selector did not retain device-font rendering");
        assert(content.root.children[0].textField?.format.font === "Microsoft YaHei Bold",
            "zero-glyph DefineFont3 selector lost its authenticated family");
        assert(content.root.children[0].textField?.useOutlines === false,
            "zero-glyph DefineFont3 selector retained a nonexistent embedded-outline requirement");

        const partial = JSON.parse(JSON.stringify(library));
        partial.assets["3"].font.glyphCount = 1;
        assertThrows(() => new FlashLibrarySymbolAdapter().parse({ ...request, library: partial }),
            "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED");
    });

    await test("Flash library static affine placements and GlowFilter emit through authenticated native seams", () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const glow = {
            kind: "glow", sourceType: "GLOWFILTER", color: { alpha: 1, color: 0 },
            blurX: 3, blurY: 3, strength: 5, passes: 1, innerGlow: false,
            knockout: false, compositeSource: true,
        };
        const gradientGlow = {
            kind: "gradient-glow", sourceType: "GRADIENTGLOWFILTER", angleRadians: Math.PI / 2,
            colors: [{ color: 0xffff00, alpha: 0 }, { color: 0xff9900, alpha: 1 }], ratios: [0, 255],
            blurX: 5, blurY: 5, distance: 5, strength: 1.359375, passes: 3,
            innerShadow: true, onTop: false, knockout: false, compositeSource: true, type: "inner",
        };
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 100, height: 80, frameRate: 30, frameCount: 1, backgroundColor: { alpha: 1, color: 0x666666 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "Role_Affine", bounds: { x: 0, y: 0, width: 100, height: 80 } },
                "2": { characterId: 2, kind: "shape", symbolName: "symbol2", path: "assets/2.png", bounds: { x: 2, y: 3, width: 8, height: 9 } },
                "3": { characterId: 3, kind: "input-text", initialText: "Name", bounds: { x: 0, y: 0, width: 60, height: 16 }, textField: {
                    align: "center", autoSize: false, border: false, color: { alpha: 1, color: 0xcc0000 },
                    fieldType: "dynamic", fontId: 4, fontSize: 12, html: false, indent: 0, initialText: "Name",
                    leading: 2, leftMargin: 0, multiline: false, password: false, rightMargin: 0,
                    selectable: false, useOutlines: false, variableName: "", wordWrap: false,
                } },
                "4": { characterId: 4, kind: "font", font: { family: "Arial", bold: false, italic: false } },
            },
        };
        const timelines = new Map([[1, {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "Role_Affine", frameRate: 30, frameCount: 1,
            frames: [{ index: 1, operations: [{
                op: "place", characterId: 2, depth: 1, move: false, ratio: 0,
                blendMode: "add", blendModeCode: 8,
                matrix: { a: 2, b: 0.25, c: -0.5, d: 3, tx: 5, ty: 7 },
            }, {
                op: "place", characterId: 3, depth: 2, move: false, ratio: 0, name: "TF_Name", filters: [gradientGlow, glow],
                matrix: { a: 0.5, b: 0, c: 0, d: 2, tx: 11, ty: 12 },
            }, {
                op: "place", characterId: 2, depth: 3, move: false, ratio: 0, name: "OverlayImage",
                blendMode: "overlay", blendModeCode: 13,
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 21 },
            }], labels: [], sounds: [] }],
        }]]);
        const request = {
            library, timelines, entrySymbolId: 1, runtimeLinkage: "Game.Role_Affine",
            resources: new Map([["assets/2.png", { sourcePath: "assets/2.png", mediaType: "image/png" as const,
                byteLength: payload.byteLength, sha256: sha256(payload) }]]),
        };
        const content = new FlashLibrarySymbolAdapter().parse(request);
        const image = content.root.children[0];
        const field = content.root.children[1];
        assert(image.matrix?.a === 2 && image.matrix.b === 0.25 && image.matrix.c === -0.5 && image.matrix.d === 3,
            "static affine matrix drifted");
        assert(image.x === 7.5 && image.y === 16.5, "affine image-bounds closure drifted");
        assert(image.blendMode === "add", "authenticated additive blend mode drifted");
        assert(content.root.children[2].blendMode === "overlay",
            "authenticated overlay blend mode drifted");
        assert(field.name === "TF_Name" && field.textField?.filters[0].kind === "gradient-glow"
            && field.textField.filters[0].strength === 1.359375 && field.textField.filters[0].quality === 3
            && field.textField.filters[1].kind === "glow" && field.textField.filters[1].strength === 5,
            "authored gradient-glow/GlowFilter placement drifted");
        const hierarchyNode = (node: any): Record<string, unknown> => ({
            "_$type": node.kind === "image" ? "Image" : node.kind === "static-text" ? "Text" : "Sprite",
            name: node.name ?? node.instanceId ?? node.linkage,
            x: node.x ?? 0,
            y: node.y ?? 0,
            width: node.width ?? 0,
            height: node.height ?? 0,
            ...(node.blendMode === undefined ? {} : { blendMode: node.blendMode }),
            ...(node.kind === "image" ? { skin: "res://shape-2.png" } : {}),
            "_$child": node.children.map(hierarchyNode),
        });
        const hierarchy = prepareNativeLayaHierarchy(content, {
            "_$ver": 1,
            ...hierarchyNode(content.root),
        }, "role-affine.mc", new Map([["flash-character-2", "shape-2.png"]]));
        const serializedField = (hierarchy._$child as any[])[1];
        assert((hierarchy._$child as any[])[0].blendMode === "add",
            "hierarchy writer lost the authenticated additive blend mode");
        assert((hierarchy._$child as any[])[2].blendMode === "overlay",
            "hierarchy writer lost the authenticated overlay blend mode");
        const serializedFilters = serializedField.authoredConfiguration.filters;
        assert(Array.isArray(serializedFilters) && serializedFilters.length === 2,
            "hierarchy writer lost the authored filter closure");
        const serializedGradientGlow = serializedFilters[0];
        assert(serializedGradientGlow.value.kind === "gradient-glow"
            && serializedGradientGlow.value.type === "inner"
            && serializedGradientGlow.value.colors[1] === 0xff9900,
            "hierarchy writer drifted the authored GradientGlowFilter configuration");
        const serializedGlow = serializedFilters[1];
        assert(serializedGlow._$type === "any" && Object.keys(serializedGlow).length === 2,
            "hierarchy writer did not seal the GlowFilter as inert decoder data");
        assert(serializedGlow.value.kind === "glow" && serializedGlow.value.color === 0
            && serializedGlow.value.alpha === 1 && serializedGlow.value.blurX === 3
            && serializedGlow.value.blurY === 3 && serializedGlow.value.strength === 5
            && serializedGlow.value.quality === 1 && serializedGlow.value.inner === false
            && serializedGlow.value.knockout === false,
            "hierarchy writer drifted the exact authored GlowFilter configuration");
        const clip = NativeLayaEmitter.createTimeline(content);
        const root = NativeLayaEmitter.createPrefabRoot(content, "role-affine.mc", clip,
            new Map([["flash-character-2", "shape-2.png"]]));
        try {
            const matrix = (root.getChildAt(0) as any).transform as Matrix;
            assert(matrix.a === 2 && matrix.b === 0.25 && matrix.c === -0.5 && matrix.d === 3,
                "native Laya affine transform drifted");
            assert((root.getChildAt(2) as any).blendMode === "overlay",
                "native Laya sprite lost the authenticated overlay blend mode");
        }
        finally {
            root.destroy();
            clip.destroy();
        }
        const malformed = structuredClone(glow) as any;
        malformed.compositeSource = false;
        timelines.get(1).frames[0].operations[1].filters = [malformed];
        assertThrows(() => new FlashLibrarySymbolAdapter().parse(request), "FLASH_LIBRARY_FILTER_COMPOSITE_SOURCE_UNSUPPORTED");
        timelines.get(1).frames[0].operations[1].filters = [gradientGlow, glow];
        timelines.get(1).frames[0].operations[2].blendModeCode = 8;
        assertThrows(() => new FlashLibrarySymbolAdapter().parse(request), "FLASH_LIBRARY_BLEND_MODE_CODE_MISMATCH");
        timelines.get(1).frames[0].operations[2].blendMode = "multiply";
        timelines.get(1).frames[0].operations[2].blendModeCode = 3;
        assertThrows(() => new FlashLibrarySymbolAdapter().parse(request), "FLASH_LIBRARY_BLEND_MODE_UNSUPPORTED");

        const invalidNeutralBlend = sourceDocument();
        (invalidNeutralBlend.root as any).children[0].blendMode = "multiply";
        assertThrows(() => normalizeNeutralAuthoredContent(invalidNeutralBlend), "AUTHORED_CONTENT_BLEND_MODE_UNSUPPORTED");
    });

    await test("Flash library signed axis-aligned bitmap fills preserve exact authored mirroring", () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const line = (from: [number, number], to: [number, number]) => ({
            kind: "line", fillStyle0: 0, fillStyle1: 1, lineStyle: 0,
            start: { from, to }, end: { from, to },
        });
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 40, height: 60, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "MirroredRoot", bounds: { x: 0, y: 0, width: 40, height: 60 } },
                "2": { characterId: 2, kind: "shape", symbolName: "MirroredBitmap", bounds: { x: 2, y: 1, width: 36, height: 57 },
                    shape: {
                        fillStyles: [{
                            kind: "bitmap", bitmapId: 3, repeat: false, smooth: false,
                            startMatrix: { a: -20, b: 0, c: 0, d: -20, tx: 38, ty: 58 },
                        }],
                        lineStyles: [], usesFillWindingRule: false,
                        segments: [
                            line([38, 1], [38, 58]), line([38, 58], [2, 58]),
                            line([2, 58], [2, 1]), line([2, 1], [38, 1]),
                        ],
                    } },
                "3": { characterId: 3, kind: "image", path: "assets/3.png",
                    bitmap: { width: 36, height: 57 } },
            },
        };
        const timelines = new Map([[1, {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "MirroredRoot", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: [{
                op: "place", characterId: 2, depth: 1, move: false, ratio: 0,
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            }], labels: [], sounds: [] }],
        }]]);
        const content = new FlashLibrarySymbolAdapter().parse({
            library, timelines, entrySymbolId: 1, runtimeLinkage: "Game.MirroredRoot",
            resources: new Map([["assets/3.png", {
                sourcePath: "assets/3.png", mediaType: "image/png" as const,
                byteLength: payload.byteLength, sha256: sha256(payload),
            }]]),
        });
        const shape = content.root.children[0];
        const projection = shape.children[0];
        assert(shape.kind === "container" && shape.x === 2 && shape.y === 1,
            "mirrored bitmap projection did not retain its authored shape bounds");
        assert(projection.x === 36 && projection.y === 57 && projection.width === 36 && projection.height === 57,
            "mirrored bitmap projection did not anchor at the authored bottom-right corner");
        assert(projection.matrix?.a === -1 && projection.matrix.b === 0
            && projection.matrix.c === 0 && projection.matrix.d === -1,
            "mirrored bitmap projection did not emit an exact native Laya flip matrix");
        const clip = NativeLayaEmitter.createTimeline(content);
        const root = NativeLayaEmitter.createPrefabRoot(content, "mirrored-root.mc", clip,
            new Map([["flash-bitmap-3", "mirrored-bitmap.png"]]));
        try {
            const nativeProjection = root.getChildAt(0).getChildAt(0) as any;
            const matrix = nativeProjection.transform as Matrix;
            assert(nativeProjection.x === 36 && nativeProjection.y === 57
                && matrix.a === -1 && matrix.d === -1,
            "signed bitmap projection did not survive native Laya node emission");
        }
        finally {
            root.destroy();
            clip.destroy();
        }

        const reverseWoundLibrary = structuredClone(library);
        const reverseWoundShape = reverseWoundLibrary.assets["2"].shape;
        reverseWoundShape.fillStyles[0].startMatrix = { a: 20, b: 0, c: 0, d: -20, tx: 2, ty: 58 };
        for (const segment of reverseWoundShape.segments) {
            segment.fillStyle0 = 1;
            segment.fillStyle1 = 0;
        }
        const reverseWound = new FlashLibrarySymbolAdapter().parse({
            library: reverseWoundLibrary, timelines, entrySymbolId: 1, runtimeLinkage: "Game.MirroredRoot",
            resources: new Map([["assets/3.png", {
                sourcePath: "assets/3.png", mediaType: "image/png" as const,
                byteLength: payload.byteLength, sha256: sha256(payload),
            }]]),
        }).root.children[0].children[0];
        assert(reverseWound.x === 0 && reverseWound.y === 57
            && reverseWound.matrix?.a === 1 && reverseWound.matrix.d === -1,
        "reverse-wound Flash fillStyle0 geometry did not preserve its exact vertical mirroring");
    });

    await test("Flash library RGB placement transforms emit exact native MovieClip configuration", () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const colorTransform = {
            redMultiplier: 0, greenMultiplier: 0, blueMultiplier: 0, alphaMultiplier: 1,
            redOffset: 212, greenOffset: 255, blueOffset: 0, alphaOffset: 0,
        };
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 40, height: 30, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "Root", bounds: { x: 0, y: 0, width: 40, height: 30 } },
                "2": { characterId: 2, kind: "sprite", symbolName: "Tinted", bounds: { x: 0, y: 0, width: 20, height: 10 } },
                "3": { characterId: 3, kind: "shape", symbolName: "Shape", path: "assets/3.png", bounds: { x: 0, y: 0, width: 20, height: 10 } },
            },
        };
        const timelines = new Map<number, any>([[1, {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "Root", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: [{
                op: "place", characterId: 2, depth: 1, move: false, ratio: 0, name: "Tinted",
                colorTransform,
            }], labels: [], sounds: [] }],
        }], [2, {
            schema: "flash-timeline@1", symbolId: 2, symbolName: "Tinted", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: [{ op: "place", characterId: 3, depth: 1, move: false, ratio: 0 }], labels: [], sounds: [] }],
        }]]);
        const content = new FlashLibrarySymbolAdapter().parse({
            library, timelines, entrySymbolId: 1, runtimeLinkage: "Game.Root",
            resources: new Map([["assets/3.png", {
                sourcePath: "assets/3.png", mediaType: "image/png" as const,
                byteLength: payload.byteLength, sha256: sha256(payload),
            }]]),
        });
        const tinted = content.root.children[0];
        assert(JSON.stringify(tinted.colorTransform) === JSON.stringify(colorTransform),
            "RGB placement color transform drifted in neutral IR");
        const nestedTimelineIds = new Map([...NativeLayaEmitter.createNestedTimelines(content).keys()]
            .map(key => [key, `nested-${key}`]));
        const hierarchy = prepareNativeLayaHierarchy(content, {
            "_$ver": 1, "_$type": "Sprite", name: "Root", width: 40, height: 30,
            "_$child": [{
                "_$type": "Sprite", name: "Tinted", width: 20, height: 10,
                "_$child": [{ "_$type": "Image", name: "Shape$d1$f1$i1", width: 20, height: 10, skin: "res://shape.png" }],
            }],
        }, "root.mc", new Map([["flash-character-3", "shape.png"]]), nestedTimelineIds);
        const serialized = (hierarchy._$child as any[])[0];
        assert(serialized._$runtime === "Laya.AuthoredContent.MovieClip",
            "RGB placement did not bind the native authored MovieClip runtime");
        assert(serialized.authoredColorTransform._$type === "any"
            && JSON.stringify(serialized.authoredColorTransform.value) === JSON.stringify(colorTransform),
            "native hierarchy lost the exact RGB placement transform");
    });

    await test("Flash library coalesces one exact repeating bitmap mosaic without raster churn", () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const line = (styleIndex: number, from: [number, number], to: [number, number]) => ({
            kind: "line", fillStyle0: 0, fillStyle1: styleIndex, lineStyle: 0,
            start: { from, to }, end: { from, to },
        });
        const rectangle = (styleIndex: number, x: number, y: number, width: number, height: number, splitTop = false) => [
            ...(splitTop ? [
                line(styleIndex, [x, y], [x + width / 2, y]),
                line(styleIndex, [x + width / 2, y], [x + width, y]),
            ] : [line(styleIndex, [x, y], [x + width, y])]),
            line(styleIndex, [x + width, y], [x + width, y + height]),
            line(styleIndex, [x + width, y + height], [x, y + height]),
            line(styleIndex, [x, y + height], [x, y]),
        ];
        const repeatedFill = () => ({
            kind: "bitmap", bitmapId: 3, repeat: true, smooth: false,
            startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 },
        });
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 40, height: 36, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "MosaicRoot", bounds: { x: 0, y: 0, width: 40, height: 36 } },
                "2": { characterId: 2, kind: "shape", symbolName: "MosaicBitmap", bounds: { x: 0, y: 0, width: 40, height: 36 },
                    shape: {
                        fillStyles: [repeatedFill(), repeatedFill(), repeatedFill(), repeatedFill()],
                        lineStyles: [], usesFillWindingRule: false,
                        segments: [
                            ...rectangle(1, 0, 0, 20, 18, true),
                            ...rectangle(2, 20, 0, 20, 18),
                            ...rectangle(3, 0, 18, 20, 18),
                            ...rectangle(4, 20, 18, 20, 18),
                        ],
                    } },
                "3": { characterId: 3, kind: "image", path: "assets/3.png", bitmap: { width: 40, height: 36 } },
            },
        };
        const timelines = new Map([[1, {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "MosaicRoot", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: [{
                op: "place", characterId: 2, depth: 1, move: false, ratio: 0,
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            }], labels: [], sounds: [] }],
        }]]);
        const request = {
            library, timelines, entrySymbolId: 1, runtimeLinkage: "Game.MosaicRoot",
            resources: new Map([["assets/3.png", {
                sourcePath: "assets/3.png", mediaType: "image/png" as const,
                byteLength: payload.byteLength, sha256: sha256(payload),
            }]]),
        };
        const projection = new FlashLibrarySymbolAdapter().parse(request).root.children[0];
        assert(projection.kind === "image" && projection.resourceId === "flash-bitmap-3"
            && projection.width === 40 && projection.height === 36 && projection.children.length === 0,
        "exact repeating bitmap mosaic did not coalesce to its sole authenticated bitmap");

        const mismatchedMatrix = structuredClone(library);
        mismatchedMatrix.assets["2"].shape.fillStyles[3].startMatrix.tx = 1;
        assertThrows(() => new FlashLibrarySymbolAdapter().parse({ ...request, library: mismatchedMatrix }),
            "FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED");

        const missingRegion = structuredClone(library);
        missingRegion.assets["2"].shape.fillStyles.pop();
        missingRegion.assets["2"].shape.segments = missingRegion.assets["2"].shape.segments
            .filter((segment: any) => segment.fillStyle1 !== 4);
        assertThrows(() => new FlashLibrarySymbolAdapter().parse({ ...request, library: missingRegion }),
            "FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED");
    });

    await test("Flash library retains boundsless named anchors and one-frame empty placeholders", () => {
        const place = (characterId: number, depth: number, name: string) => ({
            op: "place", characterId, depth, name, move: false, ratio: 0,
            matrix: { a: 1, b: 0, c: 0, d: 1, tx: 2, ty: 2 },
        });
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 100, height: 80, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "AnchorRoot", bounds: { x: 0, y: 0, width: 100, height: 80 } },
                "2": { characterId: 2, kind: "sprite", symbolName: "HeadContainer" },
                "3": { characterId: 3, kind: "sprite" },
                "4": { characterId: 4, kind: "sprite" },
            },
        };
        const timeline = (symbolId: number, operations: any[]) => ({
            schema: "flash-timeline@1", symbolId, frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations, labels: [], sounds: [] }],
        });
        const timelines = new Map([
            [1, timeline(1, [place(2, 1, "Head"), { ...place(4, 2, "unused"), name: undefined }])],
            [2, timeline(2, [place(3, 1, "mc_head")])],
            [3, timeline(3, [])],
            [4, timeline(4, [])],
        ]);
        const request = {
            library, timelines, entrySymbolId: 1, runtimeLinkage: "Game.AnchorRoot", resources: new Map(),
        };
        const head = new FlashLibrarySymbolAdapter().parse(request).root.children[0];
        assert(head.name === "Head" && head.width === 0 && head.height === 0
            && head.children[0].name === "mc_head" && head.children[0].width === 0,
        "boundsless named nonvisual hierarchy did not retain both native lookup anchors");
        const placeholder = new FlashLibrarySymbolAdapter().parse(request).root.children[1];
        assert(placeholder.name === undefined && placeholder.width === 0 && placeholder.height === 0
            && placeholder.children.length === 0,
        "boundsless unnamed one-frame empty sprite did not retain its display-list placeholder");

        const unnamedNestedAnchor = structuredClone([...timelines.entries()]);
        unnamedNestedAnchor[1][1].frames[0].operations[0].name = undefined;
        assertThrows(() => new FlashLibrarySymbolAdapter().parse({
            ...request,
            timelines: new Map(unnamedNestedAnchor),
        }), "FLASH_LIBRARY_SPRITE_BOUNDS_MISSING");

        const animatedEmptyPlaceholder = structuredClone([...timelines.entries()]);
        animatedEmptyPlaceholder[3][1].frameCount = 2;
        animatedEmptyPlaceholder[3][1].frames.push({ index: 2, operations: [], labels: [], sounds: [] });
        assertThrows(() => new FlashLibrarySymbolAdapter().parse({
            ...request,
            timelines: new Map(animatedEmptyPlaceholder),
        }), "FLASH_LIBRARY_SPRITE_BOUNDS_MISSING");
    });

    await test("Flash static depth masks bind one deterministic local Laya reference", () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 100, height: 80, frameRate: 30, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "MaskedRoot", bounds: { x: 0, y: 0, width: 100, height: 80 } },
                "2": { characterId: 2, kind: "shape", symbolName: "Mask", path: "assets/2.png", bounds: { x: 0, y: 0, width: 40, height: 30 } },
                "3": { characterId: 3, kind: "shape", symbolName: "Content", path: "assets/3.png", bounds: { x: 0, y: 0, width: 60, height: 40 } },
                "4": { characterId: 4, kind: "shape", symbolName: "Outside", path: "assets/4.png", bounds: { x: 0, y: 0, width: 10, height: 10 } },
            },
        };
        const timeline = {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "MaskedRoot", frameRate: 30, frameCount: 1,
            frames: [{ index: 1, operations: [
                { op: "place", characterId: 2, depth: 1, clipDepth: 4, move: false, ratio: 0 },
                { op: "place", characterId: 3, depth: 2, move: false, ratio: 0, name: "mc_list" },
                { op: "place", characterId: 4, depth: 5, move: false, ratio: 0, name: "outside" },
            ], labels: [], sounds: [] }],
        };
        const resources = new Map([2, 3, 4].map(id => [`assets/${id}.png`, {
            sourcePath: `assets/${id}.png`, mediaType: "image/png" as const,
            byteLength: payload.byteLength, sha256: sha256(payload),
        }]));
        const request = {
            library, timelines: new Map([[1, timeline]]), entrySymbolId: 1,
            runtimeLinkage: "Game.MaskedRoot", resources,
        };
        const content = new FlashLibrarySymbolAdapter().parse(request);
        assert(content.root.children[0].clipDepth === 4, "Flash clipDepth was not retained");
        const hierarchy = prepareNativeLayaHierarchy(content, {
            "_$ver": 1, "_$id": "root", "_$type": "Sprite", name: "MaskedRoot", width: 100, height: 80,
            "_$child": [
                { "_$id": "mask", "_$type": "Image", name: "Mask$d1$f1$i1", width: 40, height: 30, skin: "res://2.png" },
                { "_$id": "content", "_$type": "Image", name: "mc_list", width: 60, height: 40, skin: "res://3.png" },
                { "_$id": "outside", "_$type": "Image", name: "outside", width: 10, height: 10, skin: "res://4.png" },
            ],
        }, "masked-root.mc", new Map([
            ["flash-character-2", "2.png"], ["flash-character-3", "3.png"], ["flash-character-4", "4.png"],
        ]));
        const children = hierarchy._$child as any[];
        assert(children[1].mask._$ref === children[0]._$id,
            "masked child did not reference the canonicalized local mask node");
        assert(children[2].mask === undefined, "a sibling beyond clipDepth was incorrectly masked");

        timeline.frames[0].operations[0].clipDepth = 1;
        assertThrows(() => new FlashLibrarySymbolAdapter().parse(request), "FLASH_LIBRARY_MASK_RANGE_INVALID");
    });

    await test("Flash library retains multiple distinct labels authored on one frame", () => {
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 20, height: 10, frameRate: 30, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "Checkbox", bounds: { x: 0, y: 0, width: 20, height: 10 } },
            },
        };
        const timelines = new Map([[1, {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "Checkbox", frameRate: 30, frameCount: 1,
            frames: [{ index: 1, label: "Btn_CheckBoxTrue", operations: [
                { op: "label", name: "cancle" },
                { op: "label", name: "Btn_CheckBoxTrue" },
            ], labels: [], sounds: [] }],
        }]]);
        const content = new FlashLibrarySymbolAdapter().parse({
            library, timelines, entrySymbolId: 1, runtimeLinkage: "Checkbox", resources: new Map(),
        });
        assert(JSON.stringify(content.timeline.frameLabels)
            === JSON.stringify({ Btn_CheckBoxTrue: 1, cancle: 1 }),
            "co-located Flash frame labels were not retained deterministically");
    });

    await test("neutral IR admits exact flat and dotted application linkages and rejects reserved or invalid IDs", () => {
        const flat = dynamicTextDocument() as any;
        flat.root.runtimeLinkage = "MC_PetHouse";
        assert(normalizeNeutralAuthoredContent(flat).root.runtimeLinkage === "MC_PetHouse",
            "flat authored SymbolClass linkage was not preserved exactly");

        const dotted = dynamicTextDocument() as any;
        dotted.root.runtimeLinkage = "fixtures.PetHouse";
        assert(normalizeNeutralAuthoredContent(dotted).root.runtimeLinkage === "fixtures.PetHouse",
            "dotted application linkage regressed");

        for (const [runtimeLinkage, expectedCode] of [
            ["", "AUTHORED_CONTENT_STRING_REQUIRED"],
            ...[
                "9PetHouse", ".PetHouse", "PetHouse.", "Pet..House", "Pet-House",
                "flash", "flash.display.MovieClip", "laya", "laya.display.Sprite", "Laya", "Laya.Sprite",
            ].map(value => [value, "AUTHORED_CONTENT_RUNTIME_LINKAGE_INVALID"]),
        ]) {
            const invalid = dynamicTextDocument() as any;
            invalid.root.runtimeLinkage = runtimeLinkage;
            assertThrows(() => normalizeNeutralAuthoredContent(invalid), expectedCode);
        }
    });

    await test("Flash library duplicate sibling names retain native lookup names and deterministic placement IDs", () => {
        const textField = {
            align: "left", autoSize: false, border: false, color: { alpha: 1, color: 0 },
            fieldType: "dynamic", fontId: 3, fontSize: 12, html: false, indent: 0,
            initialText: "Caption", leading: 0, leftMargin: 0, multiline: false,
            password: false, rightMargin: 0, selectable: false, useOutlines: false,
            variableName: "", wordWrap: false,
        };
        const library: any = {
            schema: "flash-library@1", frameLabels: [],
            stage: { width: 100, height: 80, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
            assets: {
                "1": { characterId: 1, kind: "sprite", symbolName: "Root", bounds: { x: 0, y: 0, width: 100, height: 80 } },
                "2": { characterId: 2, kind: "input-text", symbolName: "symbol2", initialText: "Caption",
                    bounds: { x: 0, y: 0, width: 40, height: 16 }, textField },
                "3": { characterId: 3, kind: "font", font: { family: "Arial", bold: false, italic: false } },
            },
        };
        const timelines = new Map([[1, {
            schema: "flash-timeline@1", symbolId: 1, symbolName: "Root", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: [
                { op: "place", characterId: 2, depth: 1, move: false, ratio: 0, name: "TF_Caption",
                    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } },
                { op: "place", characterId: 2, depth: 2, move: false, ratio: 0, name: "TF_Caption",
                    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 20 } },
            ], labels: [], sounds: [] }],
        }]]);
        const content = new FlashLibrarySymbolAdapter().parse({
            library, timelines, entrySymbolId: 1, runtimeLinkage: "Game.DuplicateNames", resources: new Map(),
        });
        assert(content.root.children.map(child => child.name).join(",") === "TF_Caption,TF_Caption",
            "duplicate authored instance names drifted");
        assert(content.root.children.map(child => child.instanceId).join(",")
            === "symbol2$d1$f1$i1,symbol2$d2$f1$i2",
            "duplicate authored instance names did not receive deterministic placement IDs");
        const hierarchy = prepareNativeLayaHierarchy(content, {
            "_$ver": 1, "_$type": "Sprite", name: "Root", width: 100, height: 80,
            "_$child": [
                { "_$type": "Text", name: "TF_Caption", x: 0, y: 0, width: 40, height: 16 },
                { "_$type": "Text", name: "TF_Caption", x: 0, y: 20, width: 40, height: 16 },
            ],
        }, "duplicate-names.mc", new Map());
        assert((hierarchy._$child as any[]).map(child => child.name).join(",") === "TF_Caption,TF_Caption",
            "native hierarchy did not retain duplicate authored lookup names");
    });

    await test("nested MovieClip emits an independent 16-frame four-pose native timeline", () => {
        const content = normalizeNeutralAuthoredContent(nestedHappyBearDocument());
        const timelines = NativeLayaEmitter.createNestedTimelines(content);
        const clip = timelines.get("symbol21/symbol11");
        assert(timelines.size === 1 && clip !== undefined, "nested timeline closure drifted");
        const parsed = AnimationClip2D._parse(NativeAnimationClip2DWriter.write(clip)) as any;
        assert(parsed._frameRate === 30 && Math.round(parsed._duration * parsed._frameRate) === 16,
            "nested timeline frame authority drifted");
        assert(parsed.islooping === true && parsed._nodes.count === 4,
            "nested timeline loop/track closure drifted");
        for (let index = 0; index < 4; index++) {
            const track = parsed._nodes.getNodeByIndex(index);
            assert(track.nodePath.startsWith("/pose"), "nested animator target was not relative to its MovieClip");
            assert(track._keyFrames.length === 4, "pose visibility does not cover all four change frames");
        }
        const bindings = new Map([["symbol21/symbol11", { assetId: "happy-bear-timeline", clip }]]);
        const resourceBindings = new Map([1, 5, 9, 13].map(frame => [
            `happy-frame-${frame}`,
            `happy-frame-${frame}-asset`,
        ]));
        const rootClip = NativeLayaEmitter.createTimeline(content);
        const root = NativeLayaEmitter.createPrefabRoot(
            content,
            "root-timeline",
            rootClip,
            resourceBindings,
            bindings,
        ) as unknown as TestSprite;
        try {
            const bear = root.getChildAt(0);
            const animator = bear.getComponent(TestAnimatorClip2D);
            assert(animator?.clip === clip && animator.autoPlay,
                "nested MovieClip does not own its independently clocked animator");
            assert(clip.url === "res://happy-bear-timeline" && clip.uuid === "happy-bear-timeline",
                "nested timeline asset identity was not sealed");
        }
        finally {
            root.destroy();
            rootClip.destroy();
            clip.destroy();
        }
    });

    await test("canonical native bundle authenticates resource closure and emits deterministic .lh bytes", async () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const content = normalizeNeutralAuthoredContent(bitmapHierarchyDocument(payload));
        const preparation = bitmapBundlePreparation(payload);
        const hierarchy = preparation.hierarchy;
        const first = await prepareNativeLayaAuthoredContentBundle(preparation);
        const second = await prepareNativeLayaAuthoredContentBundle(preparation);
        const firstPrefab = first.files.find(file => file.kind === "prefab")!;
        const secondPrefab = second.files.find(file => file.kind === "prefab")!;
        assert(first.files.map(file => file.path).join(",") === "bitmap-hierarchy.lh,bitmap-hierarchy.mc,resources/hero.png", "bundle file closure/order drifted");
        assert(firstPrefab.bytes.every((value, index) => value === secondPrefab.bytes[index]), "canonical .lh bytes were not deterministic");
        const parsed = JSON.parse(new TextDecoder().decode(firstPrefab.bytes));
        assert(parsed._$child[0].name === "nestedSymbol", "canonical .lh child ordering drifted");
        assert(parsed._$child[0]._$child[0].skin === "res://hero-asset", "canonical .lh image binding drifted");
        assert(parsed._$authoredContent.resources[0].sha256 === sha256(payload), "canonical .lh resource authentication metadata drifted");
        assert(parsed._$preloads.join(",") === "res://hero-asset,res://timeline-asset", "native preload closure drifted");
        const timelineHierarchy = JSON.parse(JSON.stringify(hierarchy));
        timelineHierarchy._$comp = [{
            "_$type": "AnimatorClip2D",
            clip: { "_$type": "AnimationClip2D", "_$uuid": "timeline-asset" },
        }];
        const sealedTimelineHierarchy = prepareNativeLayaHierarchy(
            content,
            timelineHierarchy,
            "timeline-asset",
            new Map([["hero", "hero-asset"]]),
        ) as any;
        assert(sealedTimelineHierarchy._$comp[0].clip._$uuid === "res://timeline-asset",
            "namespaced timeline identity was not routed through AssetDb");

        const randomHierarchyA = JSON.parse(JSON.stringify(hierarchy));
        randomHierarchyA._$id = "random-root-a";
        randomHierarchyA._$child[0]._$id = "random-container-a";
        randomHierarchyA._$child[0]._$child[0]._$id = "random-image-a";
        randomHierarchyA.selectedImage = { "_$ref": "random-image-a" };
        const randomHierarchyB = JSON.parse(JSON.stringify(hierarchy));
        randomHierarchyB._$id = "random-root-b";
        randomHierarchyB._$child[0]._$id = "random-container-b";
        randomHierarchyB._$child[0]._$child[0]._$id = "random-image-b";
        randomHierarchyB.selectedImage = { "_$ref": "random-image-b" };
        const randomBundleA = await prepareNativeLayaAuthoredContentBundle({
            ...preparation,
            hierarchy: randomHierarchyA,
        });
        const randomBundleB = await prepareNativeLayaAuthoredContentBundle({
            ...preparation,
            hierarchy: randomHierarchyB,
        });
        const randomPrefabA = randomBundleA.files.find(file => file.kind === "prefab")!;
        const randomPrefabB = randomBundleB.files.find(file => file.kind === "prefab")!;
        assert(randomPrefabA.bytes.every((value, index) => value === randomPrefabB.bytes[index]),
            "opaque HierarchyWriter IDs changed canonical .lh bytes");
        const canonicalIds = JSON.parse(new TextDecoder().decode(randomPrefabA.bytes));
        const publishedIds = [
            canonicalIds._$id,
            canonicalIds._$child[0]._$id,
            canonicalIds._$child[0]._$child[0]._$id,
        ];
        assert(new Set(publishedIds).size === publishedIds.length,
            "canonical hierarchy IDs are not unique");
        assert(canonicalIds.selectedImage._$ref === canonicalIds._$child[0]._$child[0]._$id,
            "canonical hierarchy reference did not follow its target ID");

        const duplicatedId = JSON.parse(JSON.stringify(randomHierarchyA));
        duplicatedId._$child[0]._$id = duplicatedId._$id;
        await assertRejects(
            () => prepareNativeLayaAuthoredContentBundle({ ...preparation, hierarchy: duplicatedId }),
            "AUTHORED_CONTENT_NATIVE_HIERARCHY_ID_DUPLICATE",
        );
        const danglingReference = JSON.parse(JSON.stringify(randomHierarchyA));
        danglingReference.selectedImage._$ref = "missing-image";
        await assertRejects(
            () => prepareNativeLayaAuthoredContentBundle({ ...preparation, hierarchy: danglingReference }),
            "AUTHORED_CONTENT_NATIVE_HIERARCHY_REFERENCE_DANGLING",
        );
        const unknownTimeline = JSON.parse(JSON.stringify(timelineHierarchy));
        unknownTimeline._$comp[0].clip._$uuid = "unclaimed-timeline";
        await assertRejects(
            () => prepareNativeLayaAuthoredContentBundle({ ...preparation, hierarchy: unknownTimeline }),
            "AUTHORED_CONTENT_NATIVE_TIMELINE_REFERENCE_UNKNOWN",
        );

        const wrongPayload = { ...preparation, resourcePayloads: new Map([["hero", new Uint8Array([9, 9, 9, 9])]]) };
        await assertRejects(
            () => prepareNativeLayaAuthoredContentBundle(wrongPayload),
            "AUTHORED_CONTENT_RESOURCE_HASH_MISMATCH"
        );

        const image = (hierarchy._$child[0] as any)._$child[0];
        const driftCases = [
            ["x", 400, "AUTHORED_CONTENT_NATIVE_X_MISMATCH"],
            ["y", 500, "AUTHORED_CONTENT_NATIVE_Y_MISMATCH"],
            ["width", 3200, "AUTHORED_CONTENT_NATIVE_WIDTH_MISMATCH"],
            ["height", 1600, "AUTHORED_CONTENT_NATIVE_HEIGHT_MISMATCH"],
            ["alpha", 0.25, "AUTHORED_CONTENT_NATIVE_ALPHA_MISMATCH"],
            ["visible", true, "AUTHORED_CONTENT_NATIVE_VISIBLE_MISMATCH"]
        ] as const;
        for (const [field, driftedValue, diagnostic] of driftCases) {
            const driftedHierarchy = JSON.parse(JSON.stringify(hierarchy));
            driftedHierarchy._$child[0]._$child[0][field] = driftedValue;
            assertThrows(
                () => prepareNativeLayaHierarchy(content, driftedHierarchy, "timeline-asset", new Map([["hero", "hero-asset"]])),
                diagnostic
            );
            const driftedRoot = JSON.parse(JSON.stringify(hierarchy));
            driftedRoot[field] = field === "visible" ? !driftedRoot[field]
                : field === "alpha" ? driftedRoot[field] / 2 : driftedRoot[field] + 1;
            assertThrows(
                () => prepareNativeLayaHierarchy(content, driftedRoot, "timeline-asset", new Map([["hero", "hero-asset"]])),
                diagnostic
            );
        }

        const allTransformsDrifted = JSON.parse(JSON.stringify(hierarchy));
        Object.assign(allTransformsDrifted._$child[0]._$child[0], {
            x: image.x + 1,
            y: image.y + 1,
            width: image.width + 1,
            height: image.height + 1,
            alpha: 0.5,
            visible: !image.visible
        });
        assertThrows(
            () => prepareNativeLayaHierarchy(content, allTransformsDrifted, "timeline-asset", new Map([["hero", "hero-asset"]])),
            "AUTHORED_CONTENT_NATIVE_X_MISMATCH"
        );

        const nullDefaultTransform = JSON.parse(JSON.stringify(hierarchy));
        nullDefaultTransform._$child[1].x = null;
        assertThrows(
            () => prepareNativeLayaHierarchy(content, nullDefaultTransform, "timeline-asset", new Map([["hero", "hero-asset"]])),
            "AUTHORED_CONTENT_NATIVE_X_MISMATCH"
        );
    });

    await test("native bundle transaction stages all files before commit and rolls back failures", async () => {
        const bundle = await prepareNativeLayaAuthoredContentBundle(
            bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
        );
        const successEvents: string[] = [];
        await writeNativeLayaAuthoredContentTransaction(
            bundle,
            {
                async stage(path) { successEvents.push(`stage:${path}`); },
                async commit() { successEvents.push("commit"); },
                async rollback() { successEvents.push("rollback"); }
            }
        );
        assert(
            successEvents.join(",") === "stage:bitmap-hierarchy.lh,stage:bitmap-hierarchy.mc,stage:resources/hero.png,commit",
            "transaction committed before complete staging"
        );

        const failureEvents: string[] = [];
        await assertRejects(() => writeNativeLayaAuthoredContentTransaction(
            bundle,
            {
                async stage(path) {
                    failureEvents.push(`stage:${path}`);
                    if (path === "bitmap-hierarchy.mc") throw new Error("stage failure");
                },
                async commit() { failureEvents.push("commit"); },
                async rollback() { failureEvents.push("rollback"); }
            }
        ), "stage failure");
        assert(
            failureEvents.join(",") === "stage:bitmap-hierarchy.lh,stage:bitmap-hierarchy.mc,rollback",
            "failed transaction was not rolled back without commit"
        );
    });

    await test("post-prepare byte mutation is rejected before any native file is staged", async () => {
        for (const kind of ["prefab", "timeline", "image"] as const) {
            const bundle = await prepareNativeLayaAuthoredContentBundle(
                bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
            );
            const file = bundle.files.find(candidate => candidate.kind === kind)!;
            file.bytes[0] ^= 0xff;
            let staged = 0;
            await assertRejects(
                () => writeNativeLayaAuthoredContentTransaction(bundle, {
                    async stage() { staged++; },
                    async commit() { throw new Error("commit must not run"); },
                    async rollback() { throw new Error("rollback must not run"); }
                }),
                "AUTHORED_CONTENT_NATIVE_BUNDLE_BYTES_MUTATED"
            );
            assert(staged === 0, `${kind} mutation staged unauthenticated bytes`);
        }
        for (const laterIndex of [1, 2]) {
            const bundle = await prepareNativeLayaAuthoredContentBundle(
                bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
            );
            const expected = new Uint8Array(bundle.files[laterIndex].bytes);
            const staged = new Map<string, Uint8Array>();
            await writeNativeLayaAuthoredContentTransaction(bundle, {
                async stage(filePath, bytes) {
                    staged.set(filePath, new Uint8Array(bytes));
                    if (staged.size === 1)
                        bundle.files[laterIndex].bytes[0] ^= 0xff;
                },
                async commit() {},
                async rollback() { throw new Error("rollback must not run"); }
            });
            const received = staged.get(bundle.files[laterIndex].path)!;
            assert(received.length === expected.length && received.every((byte, index) => byte === expected[index]),
                `inter-stage mutation reached authenticated ${bundle.files[laterIndex].kind} staging`);
        }
    });

    await test("real importer transaction restores every target after each commit-boundary failure", async () => {
        const boundaries: NativeAssetTransactionEvent[] = [
            "before-target-verify",
            "after-backup",
            "before-install",
            "after-install"
        ];
        for (const boundary of boundaries) for (const initialState of ["existing", "absent"] as const) {
            if (initialState === "absent" && boundary === "after-backup")
                continue;
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-native-transaction-boundary-"));
            try {
                const bundle = await prepareNativeLayaAuthoredContentBundle(
                    bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
                );
                const targets = new Map(bundle.files.map(file => [
                    file.path,
                    path.join(root, "outputs", ...file.path.split("/"))
                ]));
                const originals = new Map<string, Uint8Array>();
                let value = 40;
                for (const target of targets.values()) {
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    if (initialState === "existing") {
                        const bytes = new Uint8Array([value++]);
                        originals.set(target, bytes);
                        fs.writeFileSync(target, bytes);
                    }
                }
                const transaction = new NativeAssetImporterTransaction(
                    path.join(root, "temp"),
                    targets,
                    context => {
                        if (context.event === boundary && context.relativePath === "bitmap-hierarchy.mc")
                            throw new Error(`injected ${boundary}`);
                    },
                    nativeTransactionHost
                );
                await assertRejects(
                    () => writeNativeLayaAuthoredContentTransaction(bundle, transaction),
                    `injected ${boundary}`
                );
                for (const [target, expected] of originals) {
                    const actual = fs.readFileSync(target);
                    assert(actual.length === expected.length && actual.every((byte, index) => byte === expected[index]),
                        `${boundary}/${initialState} left a partial target at ${target}`);
                }
                if (initialState === "absent") for (const target of targets.values())
                    assert(!fs.existsSync(target), `${boundary}/absent left a newly installed target at ${target}`);
                assert(!fs.existsSync(transaction.recoveryPath), `${boundary} left recovery evidence after complete rollback`);
            }
            finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    await test("real importer retry and rollback are idempotent after complete recovery", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-native-transaction-retry-"));
        try {
            const bundle = await prepareNativeLayaAuthoredContentBundle(
                bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
            );
            const targets = new Map(bundle.files.map(file => [
                file.path,
                path.join(root, "outputs", ...file.path.split("/"))
            ]));
            let failOnce = true;
            const transaction = new NativeAssetImporterTransaction(
                path.join(root, "temp"),
                targets,
                context => {
                    if (failOnce && context.event === "after-install" && context.relativePath === "bitmap-hierarchy.mc") {
                        failOnce = false;
                        throw new Error("retry boundary");
                    }
                },
                nativeTransactionHost
            );
            await assertRejects(
                () => writeNativeLayaAuthoredContentTransaction(bundle, transaction),
                "retry boundary"
            );
            await transaction.rollback();
            await writeNativeLayaAuthoredContentTransaction(bundle, transaction);
            await transaction.rollback();
            for (const file of bundle.files) {
                const actual = fs.readFileSync(targets.get(file.path)!);
                assert(actual.length === file.bytes.length && actual.every((byte, index) => byte === file.bytes[index]),
                    `retry did not install exact ${file.path} bytes`);
            }
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    await test("real importer remove/restore rollback failures are best-effort with durable aggregate evidence", async () => {
        for (const failureEvent of ["before-rollback-remove", "before-rollback-restore"] as const) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `laya-native-transaction-${failureEvent}-`));
        try {
            const bundle = await prepareNativeLayaAuthoredContentBundle(
                bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
            );
            const targets = new Map(bundle.files.map(file => [
                file.path,
                path.join(root, "outputs", ...file.path.split("/"))
            ]));
            for (const target of targets.values()) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, new Uint8Array([9]));
            }
            const rollbackEvents: string[] = [];
            const transaction = new NativeAssetImporterTransaction(
                path.join(root, "temp"),
                targets,
                context => {
                    if (context.event.startsWith("before-rollback"))
                        rollbackEvents.push(`${context.event}:${context.relativePath}`);
                    if (context.event === "after-install" && context.relativePath === "bitmap-hierarchy.mc")
                        throw new Error("injected commit failure");
                    if (context.event === failureEvent && context.relativePath === "bitmap-hierarchy.mc")
                        throw new Error(`injected ${failureEvent} failure`);
                },
                nativeTransactionHost
            );
            let received: any;
            try {
                await writeNativeLayaAuthoredContentTransaction(bundle, transaction);
            }
            catch (error) {
                received = error;
            }
            assert(received?.message.includes("AUTHORED_CONTENT_NATIVE_TRANSACTION_RECOVERY_FAILED"),
                "rollback failure did not surface as aggregate recovery failure");
            assert(Array.isArray(received.errors) && received.errors.length === 2,
                "original and rollback failures were not both retained");
            assert(rollbackEvents.includes("before-rollback-remove:bitmap-hierarchy.lh"),
                "rollback aborted instead of continuing to the earlier installed target");
            assert(rollbackEvents.includes("before-rollback-restore:bitmap-hierarchy.lh"),
                "rollback aborted instead of attempting every backup restore");
            assert(fs.readFileSync(targets.get("bitmap-hierarchy.lh")!)[0] === 9,
                "unaffected target was not restored after another rollback action failed");
            assert(fs.existsSync(transaction.recoveryPath), "incomplete rollback did not retain recovery evidence");
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
        }
    });

    await test("new-process recovery must be authenticated, resumed, and explicitly retired before retry", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-native-transaction-resume-"));
        try {
            const bundle = await prepareNativeLayaAuthoredContentBundle(
                bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
            );
            const targets = new Map(bundle.files.map(file => [
                file.path,
                path.join(root, "outputs", ...file.path.split("/"))
            ]));
            for (const target of targets.values()) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, new Uint8Array([5]));
            }
            const tempPath = path.join(root, "temp");
            const failed = new NativeAssetImporterTransaction(
                tempPath,
                targets,
                context => {
                    if (context.event === "after-install" && context.relativePath === "bitmap-hierarchy.mc")
                        throw new Error("late commit failure");
                    if (context.event === "before-rollback-remove" && context.relativePath === "bitmap-hierarchy.mc")
                        throw new Error("retained installed output");
                },
                nativeTransactionHost
            );
            await assertRejects(
                () => writeNativeLayaAuthoredContentTransaction(bundle, failed),
                "AUTHORED_CONTENT_NATIVE_TRANSACTION_RECOVERY_FAILED"
            );
            const retainedJournal = fs.readFileSync(failed.recoveryPath);
            const retry = new NativeAssetImporterTransaction(tempPath, targets, undefined, nativeTransactionHost);
            await assertRejects(
                () => retry.stage(bundle.files[0].path, bundle.files[0].bytes),
                "AUTHORED_CONTENT_NATIVE_TRANSACTION_RECOVERY_PENDING"
            );
            assert(fs.readFileSync(failed.recoveryPath).equals(retainedJournal),
                "retry initialization deleted or rewrote retained recovery authority");

            const forgedTargets = new Map(targets);
            forgedTargets.set(bundle.files[0].path, path.join(root, "forged.lh"));
            await assertRejects(
                () => resumeNativeAssetImporterRecovery(tempPath, forgedTargets, nativeTransactionHost),
                "AUTHORED_CONTENT_NATIVE_TRANSACTION_RECOVERY_TARGET_AUTHORITY_MISMATCH"
            );
            assert(fs.readFileSync(failed.recoveryPath).equals(retainedJournal),
                "rejected recovery authority changed the retained journal");

            await resumeNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
            const recovered = JSON.parse(fs.readFileSync(failed.recoveryPath, "utf8"));
            assert(recovered.installed.length === 0 && recovered.backups.length === 0,
                "successful resume did not durably record a resolved journal");
            await retireNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
            assert(!fs.existsSync(failed.recoveryPath), "explicit retirement left recovery authority behind");

            await writeNativeLayaAuthoredContentTransaction(
                bundle,
                new NativeAssetImporterTransaction(tempPath, targets, undefined, nativeTransactionHost)
            );
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    await test("write-ahead journal recovers a new process at every target mutation boundary", async () => {
        const cases: ReadonlyArray<[NativeAssetTransactionEvent, "existing" | "absent"]> = [
            ["after-backup-journal", "existing"],
            ["after-backup", "existing"],
            ["after-install-journal", "existing"],
            ["after-install", "existing"],
            ["after-install-journal", "absent"],
            ["after-install", "absent"]
        ];
        for (const [boundary, initialState] of cases) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `laya-native-crash-${boundary}-${initialState}-`));
            try {
                const bundle = await prepareNativeLayaAuthoredContentBundle(
                    bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
                );
                const targets = new Map(bundle.files.map(file => [
                    file.path,
                    path.join(root, "outputs", ...file.path.split("/"))
                ]));
                const originals = new Map<string, Uint8Array>();
                if (initialState === "existing") for (const target of targets.values()) {
                    const bytes = new Uint8Array([11]);
                    originals.set(target, bytes);
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    fs.writeFileSync(target, bytes);
                }
                const tempPath = path.join(root, "temp");
                const interrupted = new NativeAssetImporterTransaction(
                    tempPath,
                    targets,
                    context => {
                        if (context.event === boundary && context.relativePath === "bitmap-hierarchy.mc")
                            throw new Error(`simulated process interruption ${boundary}`);
                    },
                    nativeTransactionHost
                );
                for (const file of bundle.files)
                    await interrupted.stage(file.path, file.bytes);
                await assertRejects(
                    () => interrupted.commit(),
                    `simulated process interruption ${boundary}`
                );
                assert(fs.existsSync(interrupted.recoveryPath), `${boundary}/${initialState} had no durable write-ahead journal`);

                await resumeNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
                await retireNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
                for (const target of targets.values()) {
                    if (initialState === "absent")
                        assert(!fs.existsSync(target), `${boundary}/absent retained a partial target`);
                    else {
                        const actual = fs.readFileSync(target);
                        const expected = originals.get(target)!;
                        assert(actual.length === expected.length && actual.every((byte, index) => byte === expected[index]),
                            `${boundary}/existing did not restore original target bytes`);
                    }
                }
            }
            finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    await test("restart reconciles every first-journal write fsync and rename interruption", async () => {
        for (const fault of ["write", "schema-only", "sync", "rename", "directory-sync"] as const) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `laya-native-journal-${fault}-`));
            try {
                const target = path.join(root, "outputs", "asset.lh");
                const targets = new Map([["asset.lh", target]]);
                const tempPath = path.join(root, "temp");
                const transaction = new NativeAssetImporterTransaction(
                    tempPath,
                    targets,
                    undefined,
                    journalPublicationFaultHost(fault)
                );
                await assertRejects(
                    () => transaction.stage("asset.lh", new Uint8Array([1])),
                    `simulated journal ${fault === "sync" ? "fsync" : fault === "directory-sync" ? "directory fsync" : fault} interruption`
                );
                if (fault === "write" || fault === "schema-only") {
                    const quarantine = await retireAbortedNativeAssetImporterPublication(tempPath, nativeTransactionHost);
                    assert(fs.existsSync(quarantine), "partial first-journal evidence was deleted instead of quarantined");
                }
                else {
                    const paths = await listNativeAssetImporterRecoveryPaths(tempPath, nativeTransactionHost);
                    assert(paths.join(",") === "asset.lh", `${fault} restart did not expose the durable target closure`);
                    if (fault === "sync" || fault === "rename") {
                        assert(!fs.existsSync(transaction.recoveryPath), `${fault} path discovery promoted state before registered binding`);
                        assert(fs.existsSync(path.join(path.dirname(transaction.recoveryPath), "recovery.next.json")),
                            `${fault} path discovery discarded the newer journal before registered binding`);
                    }
                    await resumeNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
                    await retireNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
                }
                assert(!fs.existsSync(path.join(tempPath, "authored-content-native-transaction")),
                    `${fault} recovery left the active transaction root deadlocked`);
            }
            finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    await test("parseable malformed newer journal is quarantined without replacing published recovery", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-native-invalid-newer-journal-"));
        try {
            const tempPath = path.join(root, "temp");
            const targets = new Map([["asset.lh", path.join(root, "outputs", "asset.lh")]]);
            const transaction = new NativeAssetImporterTransaction(tempPath, targets, undefined, nativeTransactionHost);
            await transaction.stage("asset.lh", new Uint8Array([1]));
            const published = fs.readFileSync(transaction.recoveryPath);
            const transactionRoot = path.dirname(transaction.recoveryPath);
            const nextPath = path.join(transactionRoot, "recovery.next.json");
            fs.writeFileSync(nextPath, JSON.stringify({
                schema: "laya-authored-content-recovery@2",
                targets: [{ relativePath: "asset.lh", target: path.join(root, "changed-target.lh") }],
                installed: [],
                backups: [],
                failures: []
            }));
            const paths = await listNativeAssetImporterRecoveryPaths(tempPath, nativeTransactionHost);
            assert(paths.join(",") === "asset.lh", "invalid newer journal replaced the published target closure");
            assert(fs.readFileSync(transaction.recoveryPath).equals(published),
                "invalid newer journal replaced published recovery bytes");
            assert(fs.existsSync(nextPath), "path discovery promoted or discarded unbound newer authority");
            await resumeNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
            assert(fs.readdirSync(transactionRoot).some(name => name.startsWith("recovery.invalid-")),
                "invalid newer journal evidence was not quarantined");
            const reboundPublished = fs.readFileSync(transaction.recoveryPath);

            const authority = { byteLength: 1, sha256: "0".repeat(64) };
            fs.writeFileSync(nextPath, JSON.stringify({
                schema: "laya-authored-content-recovery@2",
                targets: [{ relativePath: "asset.lh", target: targets.get("asset.lh") }],
                installed: [
                    { relativePath: "asset.lh", target: targets.get("asset.lh"), authority },
                    { relativePath: "asset.lh", target: targets.get("asset.lh"), authority }
                ],
                backups: [],
                failures: []
            }));
            const duplicatePaths = await listNativeAssetImporterRecoveryPaths(tempPath, nativeTransactionHost);
            assert(duplicatePaths.join(",") === "asset.lh", "duplicate mutation records replaced published recovery");
            assert(fs.readFileSync(transaction.recoveryPath).equals(reboundPublished),
                "duplicate mutation records changed published recovery bytes");
            await resumeNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
            await retireNativeAssetImporterRecovery(tempPath, targets, nativeTransactionHost);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    await test("duplicate installed and backup recovery records fail with exact diagnostics", async () => {
        for (const kind of ["installed", "backups"] as const) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `laya-native-duplicate-${kind}-`));
            try {
                const tempPath = path.join(root, "temp");
                const transactionRoot = path.join(tempPath, "authored-content-native-transaction");
                fs.mkdirSync(transactionRoot, { recursive: true });
                const target = path.resolve(root, "outputs", "asset.lh");
                const authority = { byteLength: 1, sha256: "0".repeat(64), ...(kind === "backups" ? { exists: true } : {}) };
                const record = {
                    relativePath: "asset.lh",
                    target,
                    authority,
                    ...(kind === "backups" ? { backup: path.join(transactionRoot, "backup", "0") } : {})
                };
                fs.writeFileSync(path.join(transactionRoot, "recovery.next.json"), JSON.stringify({
                    schema: "laya-authored-content-recovery@2",
                    targets: [{ relativePath: "asset.lh", target }],
                    installed: kind === "installed" ? [record, record] : [],
                    backups: kind === "backups" ? [record, record] : [],
                    failures: []
                }));
                await assertRejects(
                    () => listNativeAssetImporterRecoveryPaths(tempPath, nativeTransactionHost),
                    kind === "installed" ? "RECOVERY_DUPLICATE_INSTALLED" : "RECOVERY_DUPLICATE_BACKUP"
                );
                const quarantine = await retireAbortedNativeAssetImporterPublication(tempPath, nativeTransactionHost);
                assert(fs.existsSync(quarantine), `duplicate ${kind} evidence was not preserved`);
            }
            finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    await test("real importer fails closed when a target is recreated during commit", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-native-transaction-recreate-"));
        try {
            const bundle = await prepareNativeLayaAuthoredContentBundle(
                bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
            );
            const targets = new Map(bundle.files.map(file => [
                file.path,
                path.join(root, "outputs", ...file.path.split("/"))
            ]));
            for (const target of targets.values()) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, new Uint8Array([7]));
            }
            const recreated = new Uint8Array([0xde, 0xad]);
            const transaction = new NativeAssetImporterTransaction(
                path.join(root, "temp"),
                targets,
                context => {
                    if (context.event === "before-install" && context.relativePath === "bitmap-hierarchy.mc")
                        fs.writeFileSync(context.target, recreated, { flag: "wx" });
                },
                nativeTransactionHost
            );
            let received: any;
            try {
                await writeNativeLayaAuthoredContentTransaction(bundle, transaction);
            }
            catch (error) {
                received = error;
            }
            assert(received?.message.includes("AUTHORED_CONTENT_NATIVE_TRANSACTION_RECOVERY_FAILED"),
                "target recreation did not fail with retained recovery authority");
            assert(fs.readFileSync(targets.get("bitmap-hierarchy.lh")!)[0] === 7,
                "target recreation prevented rollback of an earlier committed file");
            const current = fs.readFileSync(targets.get("bitmap-hierarchy.mc")!);
            assert(current.length === recreated.length && current.every((byte, index) => byte === recreated[index]),
                "rollback overwrote or deleted a concurrently recreated target");
            assert(fs.existsSync(transaction.recoveryPath), "target recreation did not retain backup recovery evidence");
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    await test("real importer rejects target byte drift after the initial snapshot", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-native-transaction-drift-"));
        try {
            const bundle = await prepareNativeLayaAuthoredContentBundle(
                bitmapBundlePreparation(new Uint8Array([1, 2, 3, 4]))
            );
            const targets = new Map(bundle.files.map(file => [
                file.path,
                path.join(root, "outputs", ...file.path.split("/"))
            ]));
            for (const target of targets.values()) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, new Uint8Array([6]));
            }
            const transaction = new NativeAssetImporterTransaction(
                path.join(root, "temp"),
                targets,
                context => {
                    if (context.event === "before-target-verify" && context.relativePath === "bitmap-hierarchy.mc")
                        fs.writeFileSync(context.target, new Uint8Array([8]));
                },
                nativeTransactionHost
            );
            await assertRejects(
                () => writeNativeLayaAuthoredContentTransaction(bundle, transaction),
                "AUTHORED_CONTENT_NATIVE_TRANSACTION_FILE_AUTHORITY_MISMATCH"
            );
            assert(fs.readFileSync(targets.get("bitmap-hierarchy.lh")!)[0] === 6,
                "target drift prevented rollback of an earlier committed file");
            assert(fs.readFileSync(targets.get("bitmap-hierarchy.mc")!)[0] === 8,
                "target drift was overwritten instead of failing closed");
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    await test("failed import can restore exact prior editor identities and bytes", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-editor-state-restore-"));
        try {
            const outputRoot = path.join(root, "outputs");
            let registered: EditorSubAssetIdentity[] = [
                { id: "prefab", fileName: "old.lh", fullPath: path.join(outputRoot, "old.lh") },
                { id: "timeline", fileName: "old.mc", fullPath: path.join(outputRoot, "old.mc") },
            ];
            fs.mkdirSync(outputRoot, { recursive: true });
            fs.writeFileSync(registered[0].fullPath, new Uint8Array([1, 2]));
            fs.writeFileSync(registered[1].fullPath, new Uint8Array([3, 4]));
            const snapshot = await captureEditorSubAssetState(registered, nativeTransactionHost);
            const library = {
                clearLibrary() {
                    for (const asset of registered)
                        fs.rmSync(asset.fullPath, { force: true });
                    registered = [];
                },
                createSubAsset(fileName: string, id?: string) {
                    const asset = { id: id!, fileName, fullPath: path.join(outputRoot, ...fileName.split("/")) };
                    registered.push(asset);
                    return asset;
                }
            };

            library.clearLibrary();
            const partial = library.createSubAsset("new.lh", "prefab");
            fs.writeFileSync(partial.fullPath, new Uint8Array([9]));
            await restoreEditorSubAssetState(
                library,
                snapshot,
                path.join(root, "editor-recovery"),
                nativeTransactionHost
            );
            assert(registered.map(asset => `${asset.id}:${asset.fileName}`).join(",") === "prefab:old.lh,timeline:old.mc",
                "editor subasset identities were not restored exactly");
            assert([...fs.readFileSync(path.join(outputRoot, "old.lh"))].join(",") === "1,2",
                "prior prefab bytes were not restored");
            assert([...fs.readFileSync(path.join(outputRoot, "old.mc"))].join(",") === "3,4",
                "prior timeline bytes were not restored");
            assert(!fs.existsSync(partial.fullPath), "partial new editor output survived state restoration");
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    await test("definition reuse and duplicate native names remain separate from placement identity", () => {
        const source = sourceDocument();
        const root = source.root as any;
        root.children[0].instanceId = "title-at-depth-1";
        root.children.push({ linkage: "Title", instanceId: "title-at-depth-2", kind: "container", children: [] });
        (source.timeline as any).tracks[0].targetPath = ["Root", "title-at-depth-1"];
        const normalized = normalizeNeutralAuthoredContent(source);
        assert(normalized.root.children[0].linkage === "Title" && normalized.root.children[1].linkage === "Title",
            "reused definition linkage drifted");
        const duplicateIdentity = structuredClone(source) as any;
        duplicateIdentity.root.children[1].instanceId = "TITLE-AT-DEPTH-1";
        assertThrows(() => normalizeNeutralAuthoredContent(duplicateIdentity), "AUTHORED_CONTENT_INSTANCE_ID_COLLISION");
        const duplicateName = structuredClone(source) as any;
        duplicateName.root.children[0].name = "sameName";
        duplicateName.root.children[1].name = "sameName";
        const duplicateNameNormalized = normalizeNeutralAuthoredContent(duplicateName);
        assert(duplicateNameNormalized.root.children.every(child => child.name === "sameName"),
            "duplicate authored native names were not retained");
        assert(new Set(duplicateNameNormalized.root.children.map(child => child.instanceId)).size === 2,
            "duplicate authored native names collapsed distinct placement identities");
    });

    await test("the same child linkage is accepted under distinct parent branches", () => {
        const source = sourceDocument();
        const root = source.root as any;
        root.children = [
            {
                linkage: "A",
                kind: "container",
                children: [{ linkage: "Title", kind: "text", text: "A", children: [] }]
            },
            {
                linkage: "B",
                kind: "container",
                children: [{ linkage: "Title", kind: "text", text: "B", children: [] }]
            }
        ];
        (source.timeline as any).tracks = [];
        const normalized = normalizeNeutralAuthoredContent(source);
        assert(normalized.root.children[0].children[0].linkage === "Title", "A/Title was not retained");
        assert(normalized.root.children[1].children[0].linkage === "Title", "B/Title was not retained");
    });

    await test("SWF XML rejects non-boolean timeline loop values", () => {
        const xml = [
            '<swf-authored-content version="1" id="strict-loop">',
            '  <node linkage="Root" kind="container"/>',
            '  <timeline frameRate="24" duration="1" loop="sometimes"/>',
            '</swf-authored-content>'
        ].join("\n");
        assertThrows(
            () => new SwfXmlSourceAdapter().parseText(xml),
            "AUTHORED_CONTENT_SWF_XML_BOOLEAN_INVALID"
        );
    });

    await test("SWF XML rejects every undeclared or duplicate structural input", () => {
        const cases: Array<[string, string]> = [
            [
                '<swf-authored-content version="1" id="x" extra="ignored"><node linkage="Root" kind="container"/><timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_ATTRIBUTE_UNSUPPORTED"
            ],
            [
                '<swf-authored-content version="1" id="x" id="ignored"><node linkage="Root" kind="container"/><timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_ATTRIBUTE_DUPLICATE"
            ],
            [
                '<swf-authored-content version="1" id="x"><node linkage="Root" kind="container"/><node linkage="Other" kind="container"/><timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_ELEMENT_COUNT"
            ],
            [
                '<swf-authored-content version="1" id="x"><node linkage="Root" kind="container"/><timeline frameRate="24" duration="1" loop="true"/><timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_ELEMENT_COUNT"
            ],
            [
                '<swf-authored-content version="1" id="x"><node linkage="Root" kind="container"><script/></node><timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_ELEMENT_UNSUPPORTED"
            ],
            [
                '<swf-authored-content version="1" id="x"><children/><node linkage="Root" kind="container"/><timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_ELEMENT_UNSUPPORTED"
            ],
            [
                '<swf-authored-content version="1" id="x"><node linkage="Root" kind="container"/><timeline frameRate="24" duration="1" loop="true"><track target="Root" property="x"><script/></track></timeline></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_ELEMENT_UNSUPPORTED"
            ],
            [
                '<swf-authored-content version="1" id="x"><node linkage="Root" kind="container"/>ignored<timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_IGNORED_CONTENT"
            ],
            [
                '<!-- ignored --><swf-authored-content version="1" id="x"><node linkage="Root" kind="container"/><timeline frameRate="24" duration="1" loop="true"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_IGNORED_CONTENT"
            ],
            [
                '<swf-authored-content version="1" id="x"><node linkage="Root" kind="container"/><timeline frameRate="24" duration="1" loop="true"/>',
                "AUTHORED_CONTENT_SWF_XML_UNBALANCED"
            ],
            [
                '<swf-authored-content version="1" id="x"><node linkage="Root" kind="container"><node linkage="Child" kind="container"/></swf-authored-content>',
                "AUTHORED_CONTENT_SWF_XML_UNBALANCED"
            ]
        ];
        for (const [xml, code] of cases)
            assertThrows(() => new SwfXmlSourceAdapter().parseText(xml), code);
    });

    await test("native frame rate is an exact signed-parser-safe integer", () => {
        for (const frameRate of [1.5, 0, -1, 32768]) {
            const source = sourceDocument();
            (source.timeline as any).frameRate = frameRate;
            assertThrows(() => normalizeNeutralAuthoredContent(source), "AUTHORED_CONTENT_FRAME_RATE_RANGE");
        }
        const maximum = sourceDocument();
        (maximum.timeline as any).frameRate = 32767;
        const maximumContent = normalizeNeutralAuthoredContent(maximum);
        const maximumBytes = NativeAnimationClip2DWriter.write(NativeLayaEmitter.createTimeline(maximumContent));
        const maximumParsed = AnimationClip2D._parse(maximumBytes) as any;
        assert(maximumParsed._frameRate === 32767, "maximum signed native frame rate did not round-trip");

        const direct = NativeLayaEmitter.createTimeline(normalizeNeutralAuthoredContent(sourceDocument())) as any;
        direct._frameRate = 1.5;
        assertThrows(() => NativeAnimationClip2DWriter.write(direct), "AUTHORED_CONTENT_NATIVE_FRAME_RATE_RANGE");
    });

    await test("uncaptured animation controllers are rejected", () => {
        const source = { ...sourceDocument(), controller: {} };
        assertThrows(() => normalizeNeutralAuthoredContent(source), "AUTHORED_CONTENT_CONTROLLER_CAPTURE_REQUIRED");
    });

    await test("native writer round-trips through the engine AnimationClip2D parser", () => {
        const content = normalizeNeutralAuthoredContent(sourceDocument());
        const clip = NativeLayaEmitter.createTimeline(content);
        const bytes = NativeAnimationClip2DWriter.write(clip);
        const header = new Byte(bytes).readUTFString();
        assert(header === "LAYAANIMATION2D:01", "unexpected native animation header");
        const parsed = AnimationClip2D._parse(bytes) as any;
        assert(parsed._frameRate === 24, "frame rate did not round-trip");
        assert(parsed._duration === 1, "duration did not round-trip");
        assert(parsed.islooping === true, "loop flag did not round-trip");
        assert(parsed._nodes.count === 1, "track count did not round-trip");
        const node = parsed._nodes.getNodeByIndex(0);
        assert(node._keyFrames.length === 2, "keyframes did not round-trip");
        assert(node._keyFrames[1].data.val === 50, "keyframe value did not round-trip");
    });

    await test("authored visual-state objects round-trip as discrete native keyframes", () => {
        const source = sourceDocument() as any;
        const identity = {
            redMultiplier: 1, greenMultiplier: 1, blueMultiplier: 1, alphaMultiplier: 1,
            redOffset: 0, greenOffset: 0, blueOffset: 0, alphaOffset: 0,
        };
        source.timeline.tracks = [{
            targetPath: ["Root", "Title"],
            property: "authoredVisualState",
            keyframes: [{ time: 0, value: { colorTransform: identity, filters: [] } }, {
                time: 1,
                value: {
                    colorTransform: { ...identity, redMultiplier: 0.5, redOffset: 32 },
                    filters: [{ kind: "blur", blurX: 2, blurY: 3, quality: 1 }],
                },
            }],
        }];
        const content = normalizeNeutralAuthoredContent(source);
        const parsed = AnimationClip2D._parse(
            NativeAnimationClip2DWriter.write(NativeLayaEmitter.createTimeline(content)),
        ) as any;
        const track = parsed._nodes.getNodeByIndex(0);
        assert(track.propertyCount === 1 && track.getPropertyByIndex(0) === "authoredVisualState",
            "visual-state property binding drifted");
        assert(track._keyFrames.every((keyframe: any) => keyframe.data.tweenType === undefined),
            "visual-state keyframes must remain discrete holds");
        assert(JSON.stringify(track._keyFrames[1].data.val) === JSON.stringify(source.timeline.tracks[0].keyframes[1].value),
            "visual-state object did not round-trip through the native writer/parser");
    });

    await test("animated affine matrix components round-trip to native transform bindings", () => {
        const affine = {
            matrixA: 0.000091552734,
            matrixB: 1.0165405,
            matrixC: -1,
            matrixD: 0.000091552734,
        } as const;
        const source = sourceDocument() as any;
        source.timeline.tracks = Object.entries(affine).map(([property, value]) => ({
            targetPath: ["Root", "Title"],
            property,
            keyframes: [{ time: 0, value }, { time: 1, value }],
        }));
        const content = normalizeNeutralAuthoredContent(source);
        assert(content.timeline.tracks.map(track => track.property).join(",")
            === "matrixA,matrixB,matrixC,matrixD", "neutral affine component order drifted");

        const parsed = AnimationClip2D._parse(
            NativeAnimationClip2DWriter.write(NativeLayaEmitter.createTimeline(content)),
        ) as any;
        const rendered = new Matrix();
        try {
            const observed = new Map<string, number>();
            for (let index = 0; index < parsed._nodes.count; index++) {
                const node = parsed._nodes.getNodeByIndex(index);
                assert(node.propertyCount === 2 && node.getPropertyByIndex(0) === "transform",
                    "affine timeline did not bind through the native Sprite transform");
                const component = node.getPropertyByIndex(1) as "a" | "b" | "c" | "d";
                const value = node._keyFrames[0].data.val as number;
                observed.set(component, value);
                rendered[component] = value;
            }
            for (const [component, expected] of Object.entries({
                a: affine.matrixA, b: affine.matrixB, c: affine.matrixC, d: affine.matrixD,
            })) {
                assert(Math.abs((rendered as any)[component] - expected) < 1e-6,
                    `native affine render component ${component} drifted`);
            }
            assert(Math.abs(rendered.a * rendered.d - rendered.b * rendered.c) > 0,
                "native affine render state became singular");
            assert(observed.size === 4, "native affine component closure drifted");
        }
        finally {
            rendered.destroy();
            parsed.destroy();
        }
    });

    await test("normalized content emits deterministic native animation bytes", () => {
        const firstContent = normalizeNeutralAuthoredContent(sourceDocument());
        const secondContent = normalizeNeutralAuthoredContent(sourceDocument());
        const first = new Uint8Array(NativeAnimationClip2DWriter.write(NativeLayaEmitter.createTimeline(firstContent)));
        const second = new Uint8Array(NativeAnimationClip2DWriter.write(NativeLayaEmitter.createTimeline(secondContent)));
        assert(first.length === second.length, "native animation byte lengths differ");
        assert(first.every((value, index) => value === second[index]), "native animation bytes are not deterministic");
    });

    await test("metadata preserves linkage, named-instance paths, and timeline identity", () => {
        const content = normalizeNeutralAuthoredContent(sourceDocument());
        const metadata = NativeLayaEmitter.createMetadata(content, "timeline");
        assert(metadata.rootLinkageClass === "Root", "root linkage class was lost");
        assert(metadata.timelineAssetId === "timeline", "timeline semantic identity was lost");
        assert(metadata.nodes[1].linkageClass === "Title", "child linkage class was lost");
        assert(metadata.nodes[1].instanceName === "titleField", "authored instance name was lost");
        assert(metadata.nodes[1].nativePath.join("/") === "Root/titleField", "native named-instance path is unstable");
        assert(metadata.nodes[1].animatorOwnerPath.join("/") === "titleField", "animator owner path is not root-relative");
    });

    await test("frame labels survive neutral normalization, native hierarchy emission, and metadata", () => {
        const content = normalizeNeutralAuthoredContent(labeledMovieClipDocument());
        assert(JSON.stringify(content.timeline.frameLabels) === JSON.stringify({ ready: 1 }),
            "root frame labels were not normalized deterministically");
        assert(JSON.stringify(content.root.children[0].timeline?.frameLabels)
            === JSON.stringify({ disabled: 4, down: 3, over: 2, up: 1 }),
            "nested frame labels were not normalized deterministically");
        const nestedIds = new Map([["Root/ButtonStates", "button-states.mc"]]);
        const hierarchy = prepareNativeLayaHierarchy(content, {
            "_$ver": 1,
            "_$type": "Sprite",
            name: "Root",
            width: 100,
            height: 80,
            "_$child": [{
                "_$type": "Sprite",
                name: "Btn_Activate",
                width: 20,
                height: 10,
            }],
        }, "root.mc", new Map(), nestedIds);
        assert(JSON.stringify(Reflect.get(Reflect.get(hierarchy, "authoredFrameLabels"), "value")) === JSON.stringify({ ready: 1 }),
            "root frame labels were not serialized into the native hierarchy");
        const hierarchyChildren = hierarchy._$child;
        assert(Array.isArray(hierarchyChildren) && hierarchyChildren.length === 1,
            "nested labeled hierarchy child closure drifted");
        const button = hierarchyChildren[0];
        assert(typeof button === "object" && button !== null && !Array.isArray(button),
            "nested labeled hierarchy is not an object");
        assert(Reflect.get(button, "_$runtime") === "Laya.AuthoredContent.MovieClip",
            "nested labeled symbol did not retain its native MovieClip runtime");
        assert(JSON.stringify(Reflect.get(Reflect.get(button, "authoredFrameLabels"), "value"))
            === JSON.stringify({ disabled: 4, down: 3, over: 2, up: 1 }),
            "nested frame labels were not serialized into the native hierarchy");
        const metadata = hierarchy._$authoredContent;
        assert(typeof metadata === "object" && metadata !== null, "authored metadata is missing");
        assert(JSON.stringify(Reflect.get(metadata, "frameLabels")) === JSON.stringify({ ready: 1 }),
            "root frame labels were not published in authored metadata");
        const nestedMetadata = Reflect.get(metadata, "nestedTimelines");
        assert(Array.isArray(nestedMetadata) && nestedMetadata.length === 1,
            "nested timeline metadata closure drifted");
        assert(JSON.stringify(Reflect.get(nestedMetadata[0], "frameLabels"))
            === JSON.stringify({ disabled: 4, down: 3, over: 2, up: 1 }),
            "nested frame labels were not published in authored metadata");

        const prototypeLabelDocument = structuredClone(labeledMovieClipDocument());
        Reflect.set(Reflect.get(prototypeLabelDocument, "timeline"), "frameLabels", JSON.parse('{"__proto__":1}'));
        const prototypeLabels = normalizeNeutralAuthoredContent(prototypeLabelDocument).timeline.frameLabels;
        assert(Object.prototype.hasOwnProperty.call(prototypeLabels, "__proto__") && prototypeLabels.__proto__ === 1,
            "valid prototype-shaped frame label was not retained as immutable data");

        const printableLabelDocument = structuredClone(labeledMovieClipDocument());
        Reflect.set(Reflect.get(printableLabelDocument, "timeline"), "frameLabels", { "无活动": 1, "ready state": 1 });
        assert(JSON.stringify(normalizeNeutralAuthoredContent(printableLabelDocument).timeline.frameLabels)
            === JSON.stringify({ "ready state": 1, "无活动": 1 }),
            "printable Flash frame labels were not retained exactly");

        for (const [label, frame, code] of [
            ["invalid\u0000label", 1, "AUTHORED_CONTENT_FRAME_LABEL_INVALID"],
            ["outside", 5, "AUTHORED_CONTENT_FRAME_LABEL_RANGE"],
        ] as const) {
            const invalid = structuredClone(labeledMovieClipDocument());
            const root = Reflect.get(invalid, "root");
            const children = Reflect.get(root, "children");
            const nestedTimeline = Reflect.get(children[0], "timeline");
            Reflect.set(nestedTimeline, "frameLabels", { [label]: frame });
            assertThrows(() => normalizeNeutralAuthoredContent(invalid), code);
        }
    });

    await test("authored button hierarchy serializes native state primitives and named placement", () => {
        const state = (name: string) => ({
            linkage: `Close_${name}`,
            name,
            kind: "button-state",
            children: [],
        });
        const content = normalizeNeutralAuthoredContent({
            schema: "neutral-authored-content@1",
            documentId: "button-host",
            resources: [],
            root: {
                linkage: "ButtonHost",
                kind: "container",
                width: 100,
                height: 50,
                children: [{
                    linkage: "CloseButton",
                    name: "Btn_Close",
                    kind: "button",
                    depth: 3,
                    x: 11,
                    y: 12,
                    width: 28,
                    height: 19,
                    variable: true,
                    children: [state("upState"), state("overState"), state("downState"), state("hitTestState")],
                }],
            },
            timeline: { frameRate: 30, duration: 1 / 30, loop: false, tracks: [] },
        });
        const hierarchy = prepareNativeLayaHierarchy(content, {
            "_$ver": 1,
            "_$type": "Sprite",
            name: "ButtonHost",
            width: 100,
            height: 50,
            "_$child": [{
                "_$type": "Sprite",
                name: "Btn_Close",
                x: 11,
                y: 12,
                width: 28,
                height: 19,
                "_$child": ["upState", "overState", "downState", "hitTestState"].map(name => ({
                    "_$type": "Sprite",
                    name,
                })),
            }],
        }, "root.mc", new Map());
        const hierarchyChildren = hierarchy._$child;
        assert(Array.isArray(hierarchyChildren) && hierarchyChildren.length === 1,
            "button hierarchy child closure drifted");
        const button = hierarchyChildren[0];
        assert(typeof button === "object" && button !== null && !Array.isArray(button),
            "serialized button is not a hierarchy object");
        assert(Reflect.get(button, "_$runtime") === "Laya.AuthoredContent.SimpleButton",
            "button runtime primitive was not serialized");
        assert(Reflect.get(button, "_$var") === true && Reflect.get(button, "name") === "Btn_Close",
            "named button placement did not retain variable injection");
        const serializedStates = Reflect.get(button, "_$child");
        assert(Array.isArray(serializedStates), "serialized button states are missing");
        assert(JSON.stringify(serializedStates.map(child => [Reflect.get(child, "name"), Reflect.get(child, "_$runtime")])) === JSON.stringify([
            ["upState", "Laya.AuthoredContent.ButtonState"],
            ["overState", "Laya.AuthoredContent.ButtonState"],
            ["downState", "Laya.AuthoredContent.ButtonState"],
            ["hitTestState", "Laya.AuthoredContent.ButtonState"],
        ]), "button state runtime hierarchy drifted");
        const metadata = hierarchy._$authoredContent;
        assert(typeof metadata === "object" && metadata !== null, "authored metadata is missing");
        const metadataNodes = Reflect.get(metadata, "nodes");
        assert(Array.isArray(metadataNodes) && Reflect.get(metadataNodes[1], "kind") === "button",
            "button metadata kind was not retained");
    });

    await test("stage metadata remains authoritative through normalization and native emission", () => {
        const source = {
            ...sourceDocument(),
            stage: {
                width: 200,
                height: 100,
                frameRate: 24,
                frameCount: 24,
                backgroundColor: { alpha: 1, color: 0 },
            },
        };
        const content = normalizeNeutralAuthoredContent(source);
        const metadata = NativeLayaEmitter.createMetadata(content, "timeline");
        assert(metadata.stage !== undefined, "stage metadata was lost");
        assert(metadata.stage.width === 200 && metadata.stage.height === 100, "stage dimensions were lost");
        assert(metadata.stage.frameRate === 24 && metadata.stage.frameCount === 24, "stage timeline authority was lost");
        assert(metadata.stage.backgroundColor.alpha === 1 && metadata.stage.backgroundColor.color === 0,
            "stage background authority was lost");
        assertThrows(() => normalizeNeutralAuthoredContent({
            ...source,
            stage: { ...source.stage, frameRate: 30 },
        }), "AUTHORED_CONTENT_STAGE_FRAME_RATE_MISMATCH");
        assertThrows(() => normalizeNeutralAuthoredContent({
            ...source,
            stage: { ...source.stage, frameCount: 1 },
        }), "AUTHORED_CONTENT_STAGE_FRAME_COUNT_MISMATCH");
    });

    await test("semantic subasset IDs are fixed and payload-independent", () => {
        const importerSource = require("fs").readFileSync(
            require("path").resolve(__dirname, "../../src/extensions/authoredContent/EnvMain.ts"),
            "utf8"
        );
        assert(importerSource.includes('createSubAsset(`${baseName}.lh`, "prefab")'), "missing prefab semantic ID");
        assert(importerSource.includes('createSubAsset(`${baseName}.mc`, "timeline")'), "missing timeline semantic ID");
        const subAssetCalls = importerSource.match(/createSubAsset\([^\n]+/g) ?? [];
        assert(!subAssetCalls.some(call => /sha|hash|random|uuid/i.test(call)), "semantic IDs must not use hashing or allocation fallbacks");
    });

    await test("import and preview use only the native hierarchy path", () => {
        const importerSource = require("fs").readFileSync(
            require("path").resolve(__dirname, "../../src/extensions/authoredContent/EnvMain.ts"),
            "utf8"
        );
        assert(
            importerSource.includes("IEditorEnv.HierarchyWriter.write(root, { creatingPrefab: true })"),
            "importer does not serialize the native prefab with HierarchyWriter"
        );
        assert(
            importerSource.includes("prepareNativeLayaAuthoredContentBundle({"),
            "importer does not authenticate and canonicalize the native hierarchy bundle"
        );
        assert(
            importerSource.includes("writeNativeLayaAuthoredContentTransaction("),
            "importer does not stage the complete native bundle transaction"
        );
        const recoveryCheck = importerSource.indexOf("isNativeAssetImporterRecoveryPending(this.tempPath)");
        assert(recoveryCheck >= 0 && recoveryCheck < importerSource.indexOf("adapter.parse("),
            "changed or corrupt source can prevent pending recovery before parsing");
        assert(recoveryCheck < importerSource.indexOf("readAuthenticatedResourcePayloads("),
            "changed or corrupt resources can prevent pending recovery before authentication");
        assert(importerSource.includes("listNativeAssetImporterRecoveryPaths(this.tempPath)"),
            "restart recovery derives its output closure from durable journal identity");
        assert(
            importerSource.indexOf("captureEditorSubAssetState(this.subAssets)") < importerSource.indexOf("this.clearLibrary()"),
            "importer does not snapshot editor identity and bytes before clearing its library"
        );
        assert(
            importerSource.includes("restoreEditorSubAssetState("),
            "a later native-bundle failure can leave partial editor subasset identity"
        );
        assert(
            importerSource.includes("Laya.Loader.HIERARCHY"),
            "preview does not load the generated .lh as a native hierarchy"
        );
        assert(!/\.prefab|\.scene|\.mcc/.test(importerSource), "legacy or unsupported runtime asset path is present");
    });

    await test("IDE-host activation remains an explicit non-MVP HOLD", () => {
        const hold = require("fs").readFileSync(
            require("path").resolve(__dirname, "../../src/extensions/authoredContent/ACTIVATION_HOLD.md"),
            "utf8"
        );
        assert(hold.includes("MVP activation therefore remains **HOLD**"), "activation HOLD is not explicit");
        assert(hold.includes("Build/typecheck/unit gates do not substitute"), "activation gate is being overclaimed");
    });

    await test("installed IDE 3.4 round-trips the actual emitted native hierarchy and clip", () => {
        runIdeHierarchyRoundTrip(
            normalizeNeutralAuthoredContent(sourceDocument()),
            NativeLayaEmitter,
            NativeAnimationClip2DWriter,
            normalizeNeutralAuthoredContent(bitmapHierarchyDocument(new Uint8Array([1, 2, 3, 4]))),
            prepareNativeLayaHierarchy
        );
    });

    console.log(`1..${passed}`);
}

function assertThrows(run: () => void, code: string): void {
    let message = "";
    try {
        run();
    }
    catch (error) {
        message = String(error);
    }
    assert(message.includes(code), `expected ${code}, received ${message}`);
}

async function assertRejects(run: () => Promise<unknown>, code: string): Promise<void> {
    let message = "";
    try {
        await run();
    }
    catch (error) {
        message = String(error);
    }
    assert(message.includes(code), `expected ${code}, received ${message}`);
}

void main().catch(error => {
    console.error(error);
    throw error;
});
