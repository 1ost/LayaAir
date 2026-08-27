"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    module._compile(ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
            target: ts.ScriptTarget.ES2019,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
        },
    }).outputText, filename);
};

const { FlashLibrarySymbolAdapter } = require(
    "../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts"
);

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const glow = () => ({
    kind: "glow", sourceType: "GLOWFILTER", color: { alpha: 1, color: 0x381a0a },
    blurX: 1, blurY: 1, strength: 3, passes: 3, innerGlow: false,
    knockout: false, compositeSource: true,
});
const frame = (index, operations = []) => ({ index, operations });
const timeline = (symbolId, frameCount, frames) => ({
    schema: "flash-timeline@1", symbolId, frameRate: 24, frameCount, frames,
});
const authority = (sourcePath, byteLength = 1) => ({
    sourcePath, mediaType: "image/png", byteLength, sha256: String(byteLength).repeat(64).slice(0, 64),
});
const rasterFrame = (sourcePath, x, y, width, height) => ({
    ...authority(sourcePath), x, y, width, height,
});

function fixture() {
    const assets = {
        "1": { characterId: 1, kind: "sprite" },
        "2": { characterId: 2, kind: "sprite", bounds: { x: 0, y: -1, width: 20, height: 10 } },
        "3": {
            characterId: 3, kind: "shape", bounds: { x: 0, y: 0, width: 40, height: 36 },
            shape: { fillStyles: [{ kind: "bitmap", bitmapId: 65535, repeat: true, smooth: true }], lineStyles: [], segments: [] },
        },
        "4": { characterId: 4, kind: "sprite" },
        "5": {
            characterId: 5, kind: "text", sourceTag: "DefineTextTag", initialText: "World",
            bounds: { x: 5, y: 0, width: 42, height: 12 },
            staticText: {
                exactGlyphs: true, issues: [], matrix: matrix(),
                runs: [{
                    color: { alpha: 1, color: 0xffd59a }, fontId: 7, fontSize: 12,
                    glyphs: [..."World"].map((character, index) => ({ character, glyphIndex: index, x: 5 + index * 8, advance: 8 })),
                    text: "World", width: 40, x: 5, y: 11,
                }],
            },
        },
        "6": {
            characterId: 6, kind: "input-text", sourceTag: "DefineEditTextTag",
            initialText: '<p align="center"><font face="Arial" size="12" color="#ffd59a" letterSpacing="2.000000" kerning="1">Guild</font></p>',
            bounds: { x: -5, y: -2, width: 62, height: 20 },
            textField: {
                align: "center", autoSize: false, border: false, color: { alpha: 1, color: 0xffd59a },
                fieldType: "dynamic", fontId: 7, fontSize: 12, html: true, indent: 0,
                initialText: '<p align="center"><font face="Arial" size="12" color="#ffd59a" letterSpacing="2.000000" kerning="1">Guild</font></p>',
                leading: 2, leftMargin: 0, multiline: true, password: false, rightMargin: 0,
                selectable: false, useOutlines: false, variableName: "", wordWrap: false,
            },
        },
        "7": { characterId: 7, kind: "font", font: { family: "Arial", bold: false, italic: false } },
        "10": { characterId: 10, kind: "sprite", symbolName: "PopupRoot", bounds: { x: 0, y: 0, width: 100, height: 50 } },
        "20": {
            characterId: 20, kind: "sprite", symbolName: "TextureRoot", bounds: { x: 0, y: 0, width: 40, height: 36 },
            scalingGrid: {
                characterId: 20, sourceTag: "DefineScalingGridTag", units: "pixels", valid: true,
                rect: { x: 12, y: 12, width: 18, height: 12 }, sizeGrid: [12, 10, 12, 12, 0],
            },
        },
        "30": { characterId: 30, kind: "sprite", symbolName: "MissingBoundsRoot", bounds: { x: 0, y: 0, width: 40, height: 36 } },
        "40": { characterId: 40, kind: "sprite", symbolName: "NativeTextRoot", bounds: { x: 0, y: 0, width: 100, height: 50 } },
    };
    const timelines = new Map([
        [1, timeline(1, 1, [frame(1)])],
        [2, timeline(2, 2, [frame(1, [{ op: "place", characterId: 3, depth: 1, move: false, ratio: 0, matrix: matrix() }]), frame(2, [{ op: "remove", depth: 1 }])])],
        [4, timeline(4, 1, [frame(1, [{ op: "place", characterId: 3, depth: 1, move: false, ratio: 0, matrix: matrix() }])])],
        [10, timeline(10, 1, [frame(1, [
            { op: "place", characterId: 1, depth: 1, move: false, ratio: 0, name: "substrate", filters: [glow()], matrix: matrix() },
            { op: "place", characterId: 2, depth: 3, move: false, ratio: 0, name: "menu", matrix: matrix() },
        ])])],
        [20, timeline(20, 1, [frame(1, [{ op: "place", characterId: 3, depth: 1, move: false, ratio: 0, matrix: matrix() }])])],
        [30, timeline(30, 1, [frame(1, [{ op: "place", characterId: 4, depth: 1, move: false, ratio: 0, matrix: matrix() }])])],
        [40, timeline(40, 1, [frame(1, [
            { op: "place", characterId: 2, depth: 1, move: false, ratio: 0, name: "staticButton", matrix: matrix() },
            { op: "place", characterId: 6, depth: 2, move: false, ratio: 0, name: "htmlLabel", matrix: matrix() },
        ])])],
    ]);
    return {
        library: {
            schema: "flash-library@1", assets, frameLabels: [],
            stage: { width: 100, height: 50, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
        },
        timelines,
        resources: new Map(),
    };
}

const adapter = new FlashLibrarySymbolAdapter();
const popup = fixture();
const popupContent = adapter.parse({
    ...popup,
    entrySymbolId: 10,
    runtimeLinkage: "fixtures.PopupRoot",
    rasterizedSprites: new Map([[2, [
        rasterFrame("sprites/menu-1.png", -3, -4, 26, 17),
        rasterFrame("sprites/menu-2.png", -3, -4, 26, 17),
    ]]]),
});
assert.deepEqual(popupContent.root.children.map(child => child.name), ["substrate", "menu"]);
assert.deepEqual(
    [popupContent.root.children[0].width, popupContent.root.children[0].height],
    [0, 0],
    "an exactly empty Flash sprite did not receive deterministic zero bounds",
);
assert.equal(popupContent.root.children[0].filters.length, 1);
assert.equal(popupContent.root.children[0].filters[0].kind, "glow");
assert.deepEqual(
    popupContent.root.children[1].children.map(child => [child.x, child.y, child.width, child.height]),
    [[-3, -4, 26, 17], [-3, -4, 26, 17]],
);
assert.deepEqual(
    popupContent.root.children[1].timeline.tracks.map(track => track.keyframes.map(keyframe => keyframe.value)),
    [[true, false], [false, true]],
);
assert.deepEqual(popupContent.resources.map(resource => resource.sourcePath), ["sprites/menu-1.png", "sprites/menu-2.png"]);

const rasterizedMorph = fixture();
rasterizedMorph.library.assets[3] = { characterId: 3, kind: "morph" };
rasterizedMorph.timelines.get(2).frames[0].operations[0].ratio = 123;
const rasterizedMorphContent = adapter.parse({
    ...rasterizedMorph,
    entrySymbolId: 10,
    runtimeLinkage: "fixtures.RasterizedMorph",
    rasterizedSprites: new Map([[2, [
        rasterFrame("sprites/morph-1.png", -3, -4, 26, 17),
        rasterFrame("sprites/morph-2.png", -3, -4, 26, 17),
    ]]]),
});
assert.deepEqual(rasterizedMorphContent.inertPlacementRatios, [{
    timelineSymbolId: 2,
    frameIndex: 1,
    operationIndex: 0,
    depth: 1,
    characterId: 3,
    characterKind: "morph-rasterized",
    ratio: 123,
}]);
for (const ratio of [1.5, 0x10000]) {
    const invalid = fixture();
    invalid.library.assets[3] = { characterId: 3, kind: "morph" };
    invalid.timelines.get(2).frames[0].operations[0].ratio = ratio;
    assert.throws(() => adapter.parse({
        ...invalid,
        entrySymbolId: 10,
        runtimeLinkage: "fixtures.InvalidRasterizedMorphRatio",
        rasterizedSprites: new Map([[2, [
            rasterFrame("sprites/morph-1.png", -3, -4, 26, 17),
            rasterFrame("sprites/morph-2.png", -3, -4, 26, 17),
        ]]]),
    }), /FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED/);
}

const nativeText = fixture();
nativeText.library.assets[5].staticText.matrix = {
    a: 1, b: 0, c: 0, d: 1, tx: 51.15, ty: -3,
};
nativeText.library.assets[5].bounds = { x: 56.15, y: -3, width: 42, height: 12 };
nativeText.timelines.set(2, timeline(2, 2, [
    frame(1, [{ op: "place", characterId: 5, depth: 2, move: false, ratio: 0, filters: [glow()], matrix: matrix() }]),
    frame(2, [{ op: "place", characterId: 3, depth: 1, move: false, ratio: 0, matrix: matrix() }]),
]));
const nativeTextContent = adapter.parse({
    ...nativeText,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.NativeTextRoot",
    rasterizedShapes: new Map([[3, authority("shapes/button-background.png", 2)]]),
    rasterizedSprites: new Map([[2, [
        rasterFrame("sprites/legacy-label-1.png", 0, 0, 20, 10),
        rasterFrame("sprites/legacy-label-2.png", 0, 0, 20, 10),
    ]]]),
});
const staticButton = nativeTextContent.root.children[0];
assert.deepEqual(staticButton.children.map(child => child.kind), ["image", "dynamic-text"]);
assert.equal(staticButton.children[1].textField.initialText, "World");
assert.equal(staticButton.children[1].textField.filters[0].kind, "glow");
assert.deepEqual([staticButton.children[1].x, staticButton.children[1].y], [56.15, -3]);
assert.equal(nativeTextContent.root.children[1].textField.initialText,
    '<p align="center"><font face="Arial" size="12" color="#ffd59a" letterSpacing="2.000000" kerning="1">Guild</font></p>');
assert.equal(nativeTextContent.root.children[1].textField.html, true);
assert.equal(nativeTextContent.root.children[1].textField.format.letterSpacing, 2);
assert.equal(nativeTextContent.root.children[1].textField.format.kerning, true);
assert.deepEqual(nativeTextContent.resources.map(resource => resource.sourcePath), ["shapes/button-background.png"]);

const texture = fixture();
texture.library.stage.width = 40;
texture.library.stage.height = 36;
const textureContent = adapter.parse({
    ...texture,
    entrySymbolId: 20,
    runtimeLinkage: "fixtures.TextureRoot",
    rasterizedShapes: new Map([[3, authority("shapes/3.png", 2)]]),
});
assert.equal(textureContent.root.children[0].resourceId, "flash-character-3");
assert.equal(textureContent.resources[0].sourcePath, "shapes/3.png");
assert.deepEqual(textureContent.root.scale9Grid, {
    x: 12, y: 12, width: 18, height: 12, sizeGrid: [12, 10, 12, 12, 0], target: "character_3$d1$f1$i1",
});

const missingBounds = fixture();
missingBounds.library.stage.width = 40;
missingBounds.library.stage.height = 36;
assert.throws(() => adapter.parse({
    ...missingBounds,
    entrySymbolId: 30,
    runtimeLinkage: "fixtures.MissingBoundsRoot",
}), /FLASH_LIBRARY_SPRITE_BOUNDS_MISSING/);

const incompleteRaster = fixture();
assert.throws(() => adapter.parse({
    ...incompleteRaster,
    entrySymbolId: 10,
    runtimeLinkage: "fixtures.IncompleteRaster",
    rasterizedSprites: new Map([[2, [rasterFrame("sprites/menu-1.png", -3, -4, 26, 17)]]]),
}), /FLASH_LIBRARY_RASTERIZED_SPRITE_FRAME_CLOSURE/);

const invalidFilter = fixture();
invalidFilter.timelines.get(10).frames[0].operations[0].filters[0].sourceType = "BLURFILTER";
assert.throws(() => adapter.parse({
    ...invalidFilter,
    entrySymbolId: 10,
    runtimeLinkage: "fixtures.InvalidFilter",
    rasterizedSprites: new Map([[2, [
        rasterFrame("sprites/menu-1.png", -3, -4, 26, 17),
        rasterFrame("sprites/menu-2.png", -3, -4, 26, 17),
    ]]]),
}), /FLASH_LIBRARY_FILTER_SOURCE_TYPE_UNSUPPORTED/);

const scaledStaticText = fixture();
scaledStaticText.library.assets[5].staticText.matrix.a = 2;
scaledStaticText.timelines.set(40, timeline(40, 1, [
    frame(1, [{ op: "place", characterId: 5, depth: 1, move: false, ratio: 0, matrix: matrix() }]),
]));
assert.throws(() => adapter.parse({
    ...scaledStaticText,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.ScaledStaticText",
}), /FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED/);

function projectedQuarterTurn(staticMatrix, bounds, placementMatrix, runtimeLinkage) {
    const source = fixture();
    source.library.assets[5].staticText.matrix = staticMatrix;
    source.library.assets[5].bounds = bounds;
    source.timelines.set(40, timeline(40, 1, [
        frame(1, [{
            op: "place", characterId: 5, depth: 1, move: false, ratio: 0,
            matrix: placementMatrix,
        }]),
    ]));
    return adapter.parse({ ...source, entrySymbolId: 40, runtimeLinkage }).root.children[0];
}

const clockwiseStaticText = projectedQuarterTurn(
    { a: 0, b: 1, c: -1, d: 0, tx: 10, ty: 20 },
    { x: -12, y: 25, width: 20, height: 42 },
    { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 200 },
    "fixtures.ClockwiseStaticText",
);
assert.deepEqual({
    x: clockwiseStaticText.x, y: clockwiseStaticText.y,
    width: clockwiseStaticText.width, height: clockwiseStaticText.height,
    matrix: clockwiseStaticText.matrix,
}, { x: 108, y: 225, width: 42, height: 20, matrix: { a: 0, b: 1, c: -1, d: 0 } });

const counterclockwiseStaticText = projectedQuarterTurn(
    { a: 0, b: -1, c: 1, d: 0, tx: 30, ty: 40 },
    { x: 32, y: -7, width: 20, height: 42 },
    { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 200 },
    "fixtures.CounterclockwiseStaticText",
);
assert.deepEqual({
    x: counterclockwiseStaticText.x, y: counterclockwiseStaticText.y,
    width: counterclockwiseStaticText.width, height: counterclockwiseStaticText.height,
    matrix: counterclockwiseStaticText.matrix,
}, { x: 132, y: 235, width: 42, height: 20, matrix: { a: 0, b: -1, c: 1, d: 0 } });

const singularStaticText = fixture();
singularStaticText.library.assets[5].staticText.matrix = { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 };
singularStaticText.timelines.set(40, timeline(40, 1, [
    frame(1, [{ op: "place", characterId: 5, depth: 1, move: false, ratio: 0, matrix: matrix() }]),
]));
assert.throws(() => adapter.parse({
    ...singularStaticText,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.SingularStaticText",
}), /FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED/);

const nonFiniteStaticText = fixture();
nonFiniteStaticText.library.assets[5].staticText.matrix.b = Number.NaN;
nonFiniteStaticText.timelines.set(40, timeline(40, 1, [
    frame(1, [{ op: "place", characterId: 5, depth: 1, move: false, ratio: 0, matrix: matrix() }]),
]));
assert.throws(() => adapter.parse({
    ...nonFiniteStaticText,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.NonFiniteStaticText",
}), /FLASH_LIBRARY_NUMBER_REQUIRED/);

const zeroDepthMixed = fixture();
zeroDepthMixed.timelines.set(40, timeline(40, 1, [frame(1, [
    { op: "place", characterId: 5, depth: 0, move: false, ratio: 0, matrix: matrix() },
    { op: "place", characterId: 6, depth: 1, move: false, ratio: 0, matrix: matrix() },
])]));
const zeroDepthMixedContent = adapter.parse({
    ...zeroDepthMixed,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.ZeroDepthMixed",
});
assert.deepEqual(zeroDepthMixedContent.root.children.map(child => child.depth), [1, 2]);

const zeroDepthAnimated = fixture();
zeroDepthAnimated.timelines.set(40, timeline(40, 2, [
    frame(1, [
        { op: "place", characterId: 5, depth: 0, move: false, ratio: 0, matrix: matrix() },
        { op: "place", characterId: 6, depth: 1, move: false, ratio: 0, matrix: matrix() },
    ]),
    frame(2, [
        { op: "place", depth: 0, move: true, ratio: 0, matrix: { ...matrix(), tx: 7 } },
        { op: "remove", depth: 1 },
    ]),
]));
const zeroDepthAnimatedContent = adapter.parse({
    ...zeroDepthAnimated,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.ZeroDepthAnimated",
});
assert.deepEqual(zeroDepthAnimatedContent.root.children.map(child => child.depth), [1, 2]);
assert.ok(zeroDepthAnimatedContent.timeline.tracks.some(track =>
    track.property === "x" && track.keyframes.some(keyframe => keyframe.value === 12)));

const ambiguousZeroDepth = fixture();
ambiguousZeroDepth.timelines.set(40, timeline(40, 1, [frame(1, [
    { op: "place", characterId: 7, depth: 0, move: false, ratio: 0, matrix: matrix() },
    { op: "place", characterId: 5, depth: 0, move: false, ratio: 0, matrix: matrix() },
])]));
assert.throws(() => adapter.parse({
    ...ambiguousZeroDepth,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.AmbiguousZeroDepth",
}), /FLASH_LIBRARY_ZERO_DEPTH_NORMALIZATION_AMBIGUOUS/);

const overflowingZeroDepth = fixture();
overflowingZeroDepth.timelines.set(40, timeline(40, 1, [frame(1, [
    { op: "place", characterId: 5, depth: 0, move: false, ratio: 0, matrix: matrix() },
    { op: "place", characterId: 6, depth: 0xffff, move: false, ratio: 0, matrix: matrix() },
])]));
assert.throws(() => adapter.parse({
    ...overflowingZeroDepth,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.OverflowingZeroDepth",
}), /FLASH_LIBRARY_ZERO_DEPTH_NORMALIZATION_UNSUPPORTED/);

const positionedStaticText = fixture();
positionedStaticText.library.assets[5] = {
    ...positionedStaticText.library.assets[5],
    initialText: "AB",
    bounds: { x: -9, y: 1.5, width: 14, height: 20 },
    staticText: {
        exactGlyphs: true,
        issues: [],
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: -14, ty: 0 },
        runs: [{
            color: { alpha: 1, color: 0xb3b3b3 }, fontId: 7, fontSize: 6,
            glyphs: [{ character: "A", glyphIndex: 1, x: 10, advance: 0 }],
            text: "A", width: 0, x: 10, y: 10,
        }, {
            color: { alpha: 1, color: 0xb3b3b3 }, fontId: 7, fontSize: 6,
            glyphs: [{ character: "B", glyphIndex: 2, x: 5, advance: 0 }],
            text: "B", width: 0, x: 5, y: 16,
        }],
    },
};
positionedStaticText.timelines.set(40, timeline(40, 1, [
    frame(1, [{
        op: "place", characterId: 5, depth: 1, move: false, ratio: 0,
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 30 },
    }]),
]));
const positionedContent = adapter.parse({
    ...positionedStaticText,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.PositionedStaticText",
});
const positioned = positionedContent.root.children[0];
assert.deepEqual(
    { kind: positioned.kind, x: positioned.x, y: positioned.y, width: positioned.width, height: positioned.height },
    { kind: "container", x: 11, y: 31.5, width: 14, height: 20 },
);
assert.deepEqual(positioned.children.map(child => ({
    kind: child.kind,
    x: child.x,
    y: child.y,
    text: child.textField.initialText,
    font: child.textField.format.font,
    color: child.textField.format.color,
})), [{ kind: "dynamic-text", x: 5, y: 2.5, text: "A", font: "Arial", color: 0xb3b3b3 },
    { kind: "dynamic-text", x: 0, y: 8.5, text: "B", font: "Arial", color: 0xb3b3b3 }]);
assert.equal(new Set(positioned.children.map(child => child.instanceId)).size, 2);

const positionedGlyphDrift = structuredClone(positionedStaticText);
positionedGlyphDrift.timelines = new Map(positionedStaticText.timelines);
positionedGlyphDrift.library.assets[5].staticText.runs[1].glyphs[0].character = "C";
assert.throws(() => adapter.parse({
    ...positionedGlyphDrift,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.PositionedGlyphDrift",
}), /FLASH_LIBRARY_STATIC_TEXT_GLYPH_TEXT_MISMATCH/);

const namedPositionedStaticText = structuredClone(positionedStaticText);
namedPositionedStaticText.timelines = new Map(positionedStaticText.timelines);
namedPositionedStaticText.timelines.get(40).frames[0].operations[0].name = "label";
assert.throws(() => adapter.parse({
    ...namedPositionedStaticText,
    entrySymbolId: 40,
    runtimeLinkage: "fixtures.NamedPositionedStaticText",
}), /FLASH_LIBRARY_NAMED_POSITIONED_STATIC_TEXT_UNSUPPORTED/);

const invalidScalingGrid = fixture();
invalidScalingGrid.library.stage.width = 40;
invalidScalingGrid.library.stage.height = 36;
invalidScalingGrid.library.assets[20].scalingGrid.sizeGrid[1] = 11;
assert.throws(() => adapter.parse({
    ...invalidScalingGrid,
    entrySymbolId: 20,
    runtimeLinkage: "fixtures.InvalidScalingGrid",
    rasterizedShapes: new Map([[3, authority("shapes/3.png", 2)]]),
}), /FLASH_LIBRARY_SCALING_GRID_INSETS_MISMATCH/);

process.stdout.write("authored popup-menu admission: 21/21 passed\n");
