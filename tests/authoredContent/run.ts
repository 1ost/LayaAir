import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { Byte } from "../../src/layaAir/laya/utils/Byte";
import { Keyframe2D } from "../../src/layaAir/laya/components/KeyFrame2D";
import { KeyframeNode2D } from "../../src/layaAir/laya/components/KeyframeNode2D";
import { KeyframeNodeList2D } from "../../src/layaAir/laya/components/KeyframeNodeList2D";
import { XML } from "../../src/layaAir/laya/html/XML";
import { SwfXmlSourceAdapter } from "../../src/extensions/authoredContent/adapters/SwfXmlSourceAdapter";
import { XflBundleSourceAdapter } from "../../src/extensions/authoredContent/adapters/XflBundleSourceAdapter";
import { normalizeNeutralAuthoredContent } from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR";
import { NativeAnimationClip2DWriter } from "../../src/extensions/authoredContent/emit/NativeAnimationClip2DWriter";
import { NativeLayaEmitter } from "../../src/extensions/authoredContent/emit/NativeLayaEmitter";
const { runIdeHierarchyRoundTrip } = require("./ideHierarchyRoundTrip.cjs") as {
    runIdeHierarchyRoundTrip(): void;
};

(globalThis as any).Laya = {
    AnimationClip2D,
    Byte,
    Keyframe2D,
    KeyframeNode2D,
    KeyframeNodeList2D,
    XML
};

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

    await test("semantic subasset IDs are fixed and payload-independent", () => {
        const importerSource = require("fs").readFileSync(
            require("path").resolve(__dirname, "../../src/extensions/authoredContent/EnvMain.ts"),
            "utf8"
        );
        assert(importerSource.includes('createSubAsset(`${baseName}.lh`, "prefab")'), "missing prefab semantic ID");
        assert(importerSource.includes('createSubAsset(`${baseName}.mc`, "timeline")'), "missing timeline semantic ID");
        assert(!/sha|hash|random|uuid/i.test(importerSource), "semantic IDs must not use hashing or allocation fallbacks");
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
            importerSource.includes("Laya.Loader.HIERARCHY"),
            "preview does not load the generated .lh as a native hierarchy"
        );
        assert(!/\.prefab|\.scene|\.mcc/.test(importerSource), "legacy or unsupported runtime asset path is present");
    });

    await test("installed IDE 3.4 hierarchy writer, parser, and SerializeUtil round-trip native .lh", () => {
        runIdeHierarchyRoundTrip();
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

void main().catch(error => {
    console.error(error);
    throw error;
});
