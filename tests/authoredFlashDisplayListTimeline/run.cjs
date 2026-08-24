"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
            target: ts.ScriptTarget.ES2019,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
        },
    });
    module._compile(output.outputText, filename);
};

const { FlashLibrarySymbolAdapter } = require("../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts");

const matrix = (a = 1, d = 1, tx = 0, ty = 0) => ({ a, b: 0, c: 0, d, tx, ty });
const petHouseAffine = () => ({
    a: 0.000091552734,
    b: 1.0165405,
    c: -1,
    d: 0.000091552734,
    tx: 13.15,
    ty: 5.05,
});
const color = alphaMultiplier => ({
    alphaMultiplier, alphaOffset: 0,
    redMultiplier: 1, redOffset: 0,
    greenMultiplier: 1, greenOffset: 0,
    blueMultiplier: 1, blueOffset: 0,
});
const rectangle = [
    [[0, 0], [20, 0]], [[20, 0], [20, 20]],
    [[20, 20], [0, 20]], [[0, 20], [0, 0]],
].map(([from, to]) => ({
    kind: "line", fillStyle0: 0, fillStyle1: 1, lineStyle: 0,
    start: { from, to }, end: { from, to },
}));

function fixture() {
    const bounds = { x: 0, y: 0, width: 20, height: 20 };
    return {
        library: {
            schema: "flash-library@1",
            assets: {
                "1": { characterId: 1, kind: "image", path: "assets/1.png" },
                "2": {
                    characterId: 2, kind: "shape", placeholder: true, bounds,
                    shape: {
                        fillStyles: [{ kind: "bitmap", bitmapId: 1, repeat: false, smooth: false, startMatrix: matrix(20, 20) }],
                        lineStyles: [], segments: structuredClone(rectangle), usesFillWindingRule: false,
                    },
                },
                "3": { characterId: 3, kind: "sprite", bounds },
                "4": { characterId: 4, kind: "sprite", bounds },
                "10": { characterId: 10, kind: "sprite", symbolName: "MiniFlag", bounds },
            },
            frameLabels: [],
            stage: { width: 1250, height: 650, frameRate: 30, frameCount: 1, backgroundColor: { alpha: 1, color: 0x333333 } },
        },
        timelines: new Map([
            [3, staticTimeline(3)],
            [4, staticTimeline(4)],
            [10, {
                schema: "flash-timeline@1", symbolId: 10, symbolName: "MiniFlag", frameRate: 30, frameCount: 3,
                frames: [
                    { index: 1, operations: [{ op: "place", characterId: 3, depth: 1, move: false, ratio: 1, matrix: petHouseAffine(), colorTransform: color(0.5) }] },
                    { index: 2, operations: [
                        { op: "place", depth: 1, move: true, ratio: 0, colorTransform: color(1) },
                        { op: "place", characterId: 4, depth: 3, move: false, ratio: 2, matrix: matrix(0.2, 0.2, 8, 9), colorTransform: color(0) },
                    ] },
                    { index: 3, operations: [
                        { op: "remove", depth: 1 },
                        { op: "place", depth: 3, move: true, ratio: 0, matrix: matrix(1, 1, 2, 3), colorTransform: color(1) },
                    ] },
                ],
            }],
        ]),
        entrySymbolId: 10,
        runtimeLinkage: "Bleach.Authored.MiniFlag",
        resources: new Map([["assets/1.png", {
            sourcePath: "assets/1.png", mediaType: "image/png", byteLength: 1, sha256: "0".repeat(64),
        }]]),
    };
}

function staticTimeline(symbolId) {
    return {
        schema: "flash-timeline@1", symbolId, frameRate: 30, frameCount: 1,
        frames: [{ index: 1, operations: [{ op: "place", characterId: 2, depth: 1, move: false, ratio: 0, matrix: matrix() }] }],
    };
}

function child(content, linkage, occurrence = 0) {
    return content.root.children.filter(value => value.linkage === linkage)[occurrence];
}

function track(content, linkage, property, occurrence = 0) {
    const instanceId = child(content, linkage, occurrence).instanceId;
    return content.timeline.tracks.find(value => value.targetPath.at(-1) === instanceId && value.property === property);
}

const adapter = new FlashLibrarySymbolAdapter();
const content = adapter.parse(fixture());
assert.equal(content.stage.frameCount, 3);
assert.deepEqual(content.inertPlacementRatios, [
    { timelineSymbolId: 10, frameIndex: 1, operationIndex: 0, depth: 1, characterId: 3, characterKind: "sprite", ratio: 1 },
    { timelineSymbolId: 10, frameIndex: 2, operationIndex: 1, depth: 3, characterId: 4, characterKind: "sprite", ratio: 2 },
]);
assert.deepEqual(content.root.children.map(value => [value.linkage, value.instanceId, value.depth]), [
    ["character_3", "character_3$d1$f1$i1", 1],
    ["character_4", "character_4$d3$f2$i2", 2],
]);
assert.deepEqual(track(content, "character_3", "visible").keyframes.map(value => value.value), [true, true, false]);
assert.deepEqual(track(content, "character_3", "alpha").keyframes.map(value => value.value), [0.5, 1, 1]);
assert.deepEqual(track(content, "character_4", "visible").keyframes.map(value => value.value), [false, true, true]);
assert.deepEqual(track(content, "character_4", "scaleX").keyframes.map(value => value.value), [1, 0.2, 1]);
assert.deepEqual(track(content, "character_4", "x").keyframes.map(value => value.value), [0, 8, 2]);
assert.deepEqual(track(content, "character_3", "matrixA").keyframes.map(value => value.value), [petHouseAffine().a, petHouseAffine().a, 1]);
assert.deepEqual(track(content, "character_3", "matrixB").keyframes.map(value => value.value), [petHouseAffine().b, petHouseAffine().b, 0]);
assert.deepEqual(track(content, "character_3", "matrixC").keyframes.map(value => value.value), [petHouseAffine().c, petHouseAffine().c, 0]);
assert.deepEqual(track(content, "character_3", "matrixD").keyframes.map(value => value.value), [petHouseAffine().d, petHouseAffine().d, 1]);
assert.deepEqual(track(content, "character_3", "x").keyframes.map(value => value.value), [13.15, 13.15, 0]);
assert.deepEqual(track(content, "character_3", "y").keyframes.map(value => value.value), [5.05, 5.05, 0]);

const replacement = fixture();
replacement.library.assets[5] = { characterId: 5, kind: "sprite", bounds: { x: 0, y: 0, width: 20, height: 20 } };
replacement.timelines.set(5, staticTimeline(5));
replacement.timelines.get(10).frames[1].operations[0].characterId = 5;
const replacementContent = adapter.parse(replacement);
assert.deepEqual(
    track(replacementContent, "character_5", "visible").keyframes.map(value => value.value),
    [false, true, false],
    "character replacement without a matrix did not retain the prior transform",
);
assert.deepEqual(
    track(replacementContent, "character_5", "x").keyframes.map(value => value.value),
    [0, 13.15, 0],
    "retained replacement matrix drifted",
);
assert.deepEqual(
    track(replacementContent, "character_5", "matrixB").keyframes.map(value => value.value),
    [0, petHouseAffine().b, 0],
    "retained replacement rotation/skew drifted",
);

const repeatedAnimated = fixture();
repeatedAnimated.timelines.get(10).frames[1].operations[1].characterId = 3;
const repeatedAnimatedContent = adapter.parse(repeatedAnimated);
const repeatedAnimatedNodes = repeatedAnimatedContent.root.children.filter(value => value.linkage === "character_3");
assert.equal(repeatedAnimatedNodes.length, 2, "repeated animated definition was not retained twice");
assert.deepEqual(repeatedAnimatedNodes.map(value => value.instanceId), [
    "character_3$d1$f1$i1", "character_3$d3$f2$i2",
]);
assert.deepEqual(track(repeatedAnimatedContent, "character_3", "visible", 0).keyframes.map(value => value.value), [true, true, false]);
assert.deepEqual(track(repeatedAnimatedContent, "character_3", "visible", 1).keyframes.map(value => value.value), [false, true, true]);

const zeroRatio = fixture();
zeroRatio.timelines.get(10).frames[0].operations[0].ratio = 0;
zeroRatio.timelines.get(10).frames[1].operations[1].ratio = 0;
const zeroRatioContent = adapter.parse(zeroRatio);
const withoutRatioEvidence = value => {
    const clone = structuredClone(value);
    delete clone.inertPlacementRatios;
    return clone;
};
assert.deepEqual(withoutRatioEvidence(content), withoutRatioEvidence(zeroRatioContent),
    "inert ratios changed native hierarchy or timeline semantics");

for (const [label, mutate, expected] of [
    ["move before place", value => value.timelines.get(10).frames[0].operations[0].move = true, /FLASH_LIBRARY_DISPLAY_DEPTH_INVALID/],
    ["RGB color transform", value => value.timelines.get(10).frames[0].operations[0].colorTransform.redMultiplier = 0.5, /FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED/],
    ["declared frame-count drift", value => value.timelines.get(10).frameCount = 4, /FLASH_LIBRARY_FRAME_CLOSURE/],
    ["nonconsecutive frame index", value => value.timelines.get(10).frames[1].index = 3, /FLASH_LIBRARY_FRAME_INDEX_INVALID/],
    ["non-unit frame duration", value => value.timelines.get(10).frames[1].durationTicks = 2, /FLASH_LIBRARY_FRAME_INDEX_INVALID/],
    ["fractional ratio", value => value.timelines.get(10).frames[0].operations[0].ratio = 1.5, /FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED/],
    ["out-of-range ratio", value => value.timelines.get(10).frames[0].operations[0].ratio = 0x10000, /FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED/],
    ["real morph target", value => value.library.assets[3].kind = "morph", /FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED/],
    ["singular matrix", value => value.timelines.get(10).frames[1].operations[1].matrix = { a: 1, b: 2, c: 2, d: 4, tx: 0, ty: 0 }, /FLASH_LIBRARY_ANIMATED_MATRIX_SINGULAR/],
    ["non-finite matrix", value => value.timelines.get(10).frames[1].operations[1].matrix.b = Number.POSITIVE_INFINITY, /FLASH_LIBRARY_NUMBER_REQUIRED/],
    ["unsupported matrix field", value => value.timelines.get(10).frames[1].operations[1].matrix.perspective = 1, /FLASH_LIBRARY_MATRIX_FIELD_UNSUPPORTED/],
]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => adapter.parse(value), expected, label);
}

const labeled = fixture();
labeled.library.stage.frameCount = 4;
labeled.library.assets["43"] = { characterId: 43, kind: "sprite" };
labeled.timelines.set(43, {
    schema: "flash-timeline@1", symbolId: 43, frameRate: 30, frameCount: 1,
    frames: [{ index: 1, operations: [] }],
});
const labeledTimeline = labeled.timelines.get(10);
labeledTimeline.frameCount = 4;
labeledTimeline.frames[0].operations.unshift(
    { op: "label", name: "up" },
    { op: "place", characterId: 43, depth: 5, move: false, ratio: 0, name: "SP_MountPoint", matrix: matrix(1, 1, -25, -3) },
);
labeledTimeline.frames[0].label = "up";
labeledTimeline.frames[1].operations.unshift({ op: "label", name: "over" });
labeledTimeline.frames[1].label = "over";
labeledTimeline.frames[2].operations.unshift({ op: "label", name: "down" });
labeledTimeline.frames[2].label = "down";
labeledTimeline.frames.push({
    index: 4,
    label: "disabled",
    operations: [{ op: "label", name: "disabled" }],
});
const labeledContent = adapter.parse(labeled);
assert.deepEqual({ ...labeledContent.timeline.frameLabels }, { up: 1, over: 2, down: 3, disabled: 4 });
const anchor = labeledContent.root.children.find(value => value.name === "SP_MountPoint");
assert.ok(anchor, "empty named anchor was not retained");
assert.deepEqual(
    { kind: anchor.kind, width: anchor.width, height: anchor.height, children: anchor.children.length, variable: anchor.variable },
    { kind: "container", width: 0, height: 0, children: 0, variable: true },
    "empty named anchor did not remain a zero-size named container",
);

for (const [label, mutate, expected] of [
    ["duplicate frame label", value => {
        value.timelines.get(10).frames[1].label = "up";
        value.timelines.get(10).frames[1].operations[0].name = "up";
    }, /FLASH_LIBRARY_FRAME_LABEL_DUPLICATE/],
    ["invalid frame label", value => {
        value.timelines.get(10).frames[0].label = "up state";
        value.timelines.get(10).frames[0].operations[0].name = "up state";
    }, /FLASH_LIBRARY_FRAME_LABEL_INVALID/],
    ["mismatched frame label operation", value => {
        value.timelines.get(10).frames[1].operations[0].name = "down";
    }, /FLASH_LIBRARY_FRAME_LABEL_OPERATION_MISMATCH/],
    ["unnamed empty sprite without bounds", value => {
        delete value.timelines.get(10).frames[0].operations[1].name;
    }, /FLASH_LIBRARY_SPRITE_BOUNDS_MISSING/],
    ["named content sprite without bounds", value => {
        value.timelines.get(43).frames[0].operations.push({
            op: "place", characterId: 3, depth: 1, move: false, ratio: 0, matrix: matrix(),
        });
    }, /FLASH_LIBRARY_SPRITE_BOUNDS_MISSING/],
]) {
    const value = structuredClone(labeled);
    value.timelines = new Map([...labeled.timelines].map(([id, timeline]) => [id, structuredClone(timeline)]));
    mutate(value);
    assert.throws(() => adapter.parse(value), expected, label);
}

process.stdout.write("authored Flash display-list timeline: 17/17 passed\n");
