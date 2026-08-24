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
                    { index: 1, operations: [{ op: "place", characterId: 3, depth: 1, move: false, ratio: 1, matrix: matrix(), colorTransform: color(0.5) }] },
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

function track(content, linkage, property) {
    return content.timeline.tracks.find(value => value.targetPath.at(-1) === linkage && value.property === property);
}

const adapter = new FlashLibrarySymbolAdapter();
const content = adapter.parse(fixture());
assert.equal(content.stage.frameCount, 3);
assert.deepEqual(content.root.children.map(value => [value.linkage, value.depth]), [["character_3", 1], ["character_4", 2]]);
assert.deepEqual(track(content, "character_3", "visible").keyframes.map(value => value.value), [true, true, false]);
assert.deepEqual(track(content, "character_3", "alpha").keyframes.map(value => value.value), [0.5, 1, 1]);
assert.deepEqual(track(content, "character_4", "visible").keyframes.map(value => value.value), [false, true, true]);
assert.deepEqual(track(content, "character_4", "scaleX").keyframes.map(value => value.value), [1, 0.2, 1]);
assert.deepEqual(track(content, "character_4", "x").keyframes.map(value => value.value), [0, 8, 2]);

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
    [0, 0, 0],
    "retained replacement matrix drifted",
);

for (const [label, mutate, expected] of [
    ["move before place", value => value.timelines.get(10).frames[0].operations[0].move = true, /FLASH_LIBRARY_DISPLAY_DEPTH_INVALID/],
    ["RGB color transform", value => value.timelines.get(10).frames[0].operations[0].colorTransform.redMultiplier = 0.5, /FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED/],
    ["skew matrix", value => value.timelines.get(10).frames[1].operations[1].matrix.b = 0.1, /FLASH_LIBRARY_ANIMATED_MATRIX_UNSUPPORTED/],
    ["duplicate semantic linkage", value => value.timelines.get(10).frames[1].operations[1].characterId = 3, /FLASH_LIBRARY_ANIMATED_LINKAGE_COLLISION/],
]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => adapter.parse(value), expected, label);
}

process.stdout.write("authored Flash display-list timeline: 6/6 passed\n");
