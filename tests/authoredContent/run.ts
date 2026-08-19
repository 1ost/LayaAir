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
import { XML } from "../../src/layaAir/laya/html/XML";
import { SwfXmlSourceAdapter } from "../../src/extensions/authoredContent/offlineAdapters/SwfXmlSourceAdapter";
import { XflBundleSourceAdapter } from "../../src/extensions/authoredContent/offlineAdapters/XflBundleSourceAdapter";
import { normalizeNeutralAuthoredContent } from "../../src/extensions/authoredContent/core/NeutralAuthoredContentIR";
import { NativeAnimationClip2DWriter } from "../../src/extensions/authoredContent/emit/NativeAnimationClip2DWriter";
import { NativeLayaEmitter } from "../../src/extensions/authoredContent/emit/NativeLayaEmitter";
import {
    NativeAssetImporterTransaction,
    NativeAssetTransactionEvent,
    NativeAssetTransactionHost
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

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function bitmapNativeHierarchy(): Record<string, any> {
    return {
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
        assert(parsed._$preloads.join(",") === "hero-asset,timeline-asset", "native preload closure drifted");

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
            driftedRoot[field] = field === "visible" ? false : field === "alpha" ? 0.5 : 1;
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
    });

    await test("real importer transaction restores every target after each commit-boundary failure", async () => {
        const boundaries: NativeAssetTransactionEvent[] = [
            "before-target-verify",
            "after-backup",
            "before-install",
            "after-install"
        ];
        for (const boundary of boundaries) {
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
                    const bytes = new Uint8Array([value++]);
                    originals.set(target, bytes);
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    fs.writeFileSync(target, bytes);
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
                        `${boundary} left a partial target at ${target}`);
                }
                assert(!fs.existsSync(transaction.recoveryPath), `${boundary} left recovery evidence after complete rollback`);
            }
            finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    await test("real importer rollback is best-effort and retains aggregate recovery evidence", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-native-transaction-rollback-"));
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
                    if (context.event === "before-rollback-remove" && context.relativePath === "bitmap-hierarchy.mc")
                        throw new Error("injected rollback removal failure");
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
