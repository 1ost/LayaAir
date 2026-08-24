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

const nativeText = fixture();
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
assert.equal(nativeTextContent.root.children[1].textField.initialText, "Guild");
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
    x: 12, y: 12, width: 18, height: 12, sizeGrid: [12, 10, 12, 12, 0], target: "character_3",
});

const missingBounds = fixture();
missingBounds.library.stage.width = 40;
missingBounds.library.stage.height = 36;
assert.throws(() => adapter.parse({
    ...missingBounds,
    entrySymbolId: 30,
    runtimeLinkage: "fixtures.MissingBoundsRoot",
}), /FLASH_LIBRARY_SPRITE_BOUNDS_REQUIRED/);

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

process.stdout.write("authored popup-menu admission: 8/8 passed\n");
