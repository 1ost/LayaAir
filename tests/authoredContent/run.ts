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
    runIdeHierarchyRoundTrip(
        content: ReturnType<typeof normalizeNeutralAuthoredContent>,
        emitter: typeof NativeLayaEmitter,
        writer: typeof NativeAnimationClip2DWriter
    ): void;
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
            importerSource.includes("hierarchy._$authoredContent = NativeLayaEmitter.createMetadata(content, timeline.id)"),
            "importer does not persist the generated-accessor metadata seam"
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
            NativeAnimationClip2DWriter
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

void main().catch(error => {
    console.error(error);
    throw error;
});
