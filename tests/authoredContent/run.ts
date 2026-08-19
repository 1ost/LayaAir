import { createHash } from "node:crypto";
import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { Byte } from "../../src/layaAir/laya/utils/Byte";
import { ILaya } from "../../src/layaAir/ILaya";
import { Keyframe2D } from "../../src/layaAir/laya/components/KeyFrame2D";
import { KeyframeNode2D } from "../../src/layaAir/laya/components/KeyframeNode2D";
import { KeyframeNodeList2D } from "../../src/layaAir/laya/components/KeyframeNodeList2D";
import { XML } from "../../src/layaAir/laya/html/XML";
import { SwfXmlSourceAdapter } from "../../src/extensions/authoredContent/offlineAdapters/SwfXmlSourceAdapter";
import { XflBundleSourceAdapter } from "../../src/extensions/authoredContent/offlineAdapters/XflBundleSourceAdapter";
import { normalizeNeutralAuthoredContent } from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR";
import { NativeAnimationClip2DWriter } from "../../src/extensions/authoredContent/emit/NativeAnimationClip2DWriter";
import { NativeLayaEmitter } from "../../src/extensions/authoredContent/emit/NativeLayaEmitter";
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
    addChild<T extends TestSprite>(child: T): T { this.children.push(child); return child; }
    getChildAt(index: number): TestSprite { return this.children[index]; }
    addComponent<T>(Component: new () => T): T { return new Component(); }
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
                children: [{
                    linkage: "HeroBitmap",
                    name: "heroImage",
                    kind: "image",
                    depth: 7,
                    resourceId: "hero",
                    width: 32,
                    height: 16,
                    children: []
                }]
            }]
        },
        timeline: { frameRate: 30, duration: 0, loop: false, tracks: [] }
    };
}

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
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
        undeclared.root.children[0].filters = [];
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

    await test("canonical native bundle authenticates resource closure and emits deterministic .lh bytes", async () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        const content = normalizeNeutralAuthoredContent(bitmapHierarchyDocument(payload));
        const hierarchy = {
            name: "Root",
            "_$ver": 1,
            "_$type": "Sprite",
            "_$child": [{
                zOrder: 10,
                name: "nestedSymbol",
                "_$type": "Sprite",
                "_$child": [{
                    skin: "res://hero-asset",
                    zOrder: 7,
                    name: "heroImage",
                    "_$type": "Image",
                    width: 32,
                    height: 16
                }]
            }, {
                zOrder: 20,
                name: "frontLayer",
                "_$type": "Sprite"
            }]
        };
        const preparation = {
            content,
            hierarchy,
            prefabPath: "bitmap-hierarchy.lh",
            timelinePath: "bitmap-hierarchy.mc",
            timelineAssetId: "timeline-asset",
            timelineBytes: new Uint8Array([7, 8, 9]),
            resourceAssetIds: new Map([["hero", "hero-asset"]]),
            resourcePayloads: new Map([["hero", payload]]),
            sha256
        };
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
        assert(parsed._$preloads.join(",") === "hero-asset,timeline-asset", "native preload closure drifted");

        const wrongPayload = { ...preparation, resourcePayloads: new Map([["hero", new Uint8Array([9, 9, 9, 9])]]) };
        await assertRejects(
            () => prepareNativeLayaAuthoredContentBundle(wrongPayload),
            "AUTHORED_CONTENT_RESOURCE_HASH_MISMATCH"
        );
    });

    await test("native bundle transaction stages all files before commit and rolls back failures", async () => {
        const files = [
            { path: "a.lh", kind: "prefab" as const, bytes: new Uint8Array([1]) },
            { path: "b.mc", kind: "timeline" as const, bytes: new Uint8Array([2]) }
        ];
        const successEvents: string[] = [];
        await writeNativeLayaAuthoredContentTransaction(
            { schema: "laya-native-authored-content-bundle@1", files },
            {
                async stage(path) { successEvents.push(`stage:${path}`); },
                async commit() { successEvents.push("commit"); },
                async rollback() { successEvents.push("rollback"); }
            }
        );
        assert(successEvents.join(",") === "stage:a.lh,stage:b.mc,commit", "transaction committed before complete staging");

        const failureEvents: string[] = [];
        await assertRejects(() => writeNativeLayaAuthoredContentTransaction(
            { schema: "laya-native-authored-content-bundle@1", files },
            {
                async stage(path) {
                    failureEvents.push(`stage:${path}`);
                    if (path === "b.mc") throw new Error("stage failure");
                },
                async commit() { failureEvents.push("commit"); },
                async rollback() { failureEvents.push("rollback"); }
            }
        ), "stage failure");
        assert(failureEvents.join(",") === "stage:a.lh,stage:b.mc,rollback", "failed transaction was not rolled back without commit");
    });

    await test("normalization collisions are rejected", () => {
        const source = sourceDocument();
        const root = source.root as any;
        root.children.push({ linkage: "Title", kind: "container", children: [] });
        assertThrows(() => normalizeNeutralAuthoredContent(source), "AUTHORED_CONTENT_LINKAGE_COLLISION");
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
