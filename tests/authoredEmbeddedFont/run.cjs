"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const ts = require("typescript");

globalThis.window = globalThis.window ?? globalThis;
globalThis.document = globalThis.document ?? {};

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
for (const extension of [".glsl", ".vs", ".fs"]) {
    require.extensions[extension] = (module, filename) => {
        module.exports = fs.readFileSync(filename, "utf8");
    };
}

const { FlashLibrarySymbolAdapter } = require(
    "../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts"
);
const { describeNativeAuthoredFontCatalog } = require(
    "../../src/extensions/authoredContent/emit/NativeAuthoredFontCatalog.ts"
);
const { prepareNativeLayaAuthoredContentBundle } = require(
    "../../src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts"
);
const { createAuthoredFilters } = require(
    "../../src/extensions/authoredContent/runtime/AuthoredTextField.ts"
);
const { isGradientBevelFilter } = require(
    "../../src/layaAir/flash/filters/GradientBevelFilter.ts"
);
const { isColorMatrixFilter } = require(
    "../../src/layaAir/flash/filters/ColorMatrixFilter.ts"
);

const TTF = Uint8Array.from([
    0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0,
    0x68, 0x65, 0x61, 0x64,
]);
const FONT_SHA = sha(TTF);

function realShapedKerning(count) {
    return Array.from({ length: count }, (_value, index) => ({
        adjustment: -(index + 1),
        leftCodePoint: 32 + index % 95,
        rightCodePoint: 32 + Math.floor(index / 95),
    })).reverse();
}

function fixture() {
    return {
        library: {
            schema: "flash-library@1",
            assets: {
                "18": {
                    characterId: 18,
                    kind: "font",
                    path: "assets/18.ttf",
                    prefab: "prefabs/18-character_18.prefab",
                    sourceTag: "DefineFont3Tag",
                    fontAlignZones: {
                        fontId: 18, sourceTag: "DefineFontAlignZonesTag", tableHint: 1, tableHintName: "medium",
                        zones: [32, 65, 86].map((_codePoint, index) => ({
                            data: [
                                { alignmentCoordinate: index / 10, alignmentCoordinateBits: index, range: 0, rangeBits: 0 },
                                { alignmentCoordinate: 0, alignmentCoordinateBits: 0, range: 1, rangeBits: 15360 },
                            ],
                            maskX: index !== 0, maskY: index !== 0,
                        })),
                    },
                    font: {
                        ascent: 18540,
                        bold: true,
                        descent: 4340,
                        embedded: true,
                        family: "Arial",
                        glyphCount: 3,
                        glyphs: [
                            { advance: 5700, bounds: { xmin: 0, xmax: 0, ymin: 0, ymax: 0 }, codePoint: 32, index: 0 },
                            { advance: 14800, bounds: { xmin: 0, xmax: 0, ymin: 0, ymax: 0 }, codePoint: 65, index: 1 },
                            { advance: 14800, bounds: { xmin: -10, xmax: 100, ymin: -20, ymax: 200 }, codePoint: 86, index: 2 },
                        ],
                        hasLayout: true,
                        italic: false,
                        kerning: realShapedKerning(909),
                        leading: 2400,
                        unitsPerEm: 20480,
                    },
                },
                "203": {
                    characterId: 203,
                    kind: "input-text",
                    bounds: { x: 0, y: 0, width: 100, height: 20 },
                    initialText: "A",
                    textRendering: {
                        gridFit: 2, gridFitMode: "subpixel", renderer: "advanced", sharpness: 0,
                        sourceTag: "CSMSettingsTag", textId: 203, thickness: 0, useFlashType: 1,
                    },
                    textField: {
                        align: "center", autoSize: false, border: false, color: { alpha: 1, color: 0xffffff },
                        fieldType: "dynamic", fontId: 18, fontSize: 12, html: false, indent: 0,
                        initialText: "A", leading: 0, leftMargin: 0, multiline: false, password: false,
                        rightMargin: 0, selectable: false, useOutlines: true, variableName: "", wordWrap: false,
                    },
                },
                "385": { characterId: 385, kind: "sprite", symbolName: "MC_PetHouse", bounds: { x: 0, y: 0, width: 100, height: 20 } },
            },
            frameLabels: [],
            stage: { width: 100, height: 20, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
        },
        timelines: new Map([[385, {
            schema: "flash-timeline@1", symbolId: 385, symbolName: "MC_PetHouse", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: [{
                op: "place", characterId: 203, depth: 1, move: false, ratio: 0, name: "TF_PetName",
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            }] }],
        }]]),
        entrySymbolId: 385,
        runtimeLinkage: "MC_PetHouse",
        projection: "library-symbol",
        resources: new Map([["assets/18.ttf", {
            sourcePath: "assets/18.ttf", mediaType: "font/ttf", byteLength: TTF.byteLength, sha256: FONT_SHA,
        }]]),
    };
}

function gradientBevelEvidence() {
    return {
        angleRadians: Math.PI / 2, blurX: 10, blurY: 10,
        colors: [{ alpha: 1, color: 0xff3300 }, { alpha: 0, color: 0xffcc33 }, { alpha: 1, color: 0xffff33 }],
        compositeSource: true, distance: 10, innerShadow: true, kind: "gradient-bevel", knockout: false,
        onTop: false, passes: 3, ratios: [29, 128, 255], sourceType: "GRADIENTBEVELFILTER",
        strength: 2, type: "inner",
    };
}

function gradientFixture() {
    const value = fixture();
    value.timelines.get(385).frames[0].operations[0].filters = [gradientBevelEvidence()];
    return value;
}

const COLOR_MATRIX = Object.freeze([
    1, 0, 0, 0, 30,
    0, 1, 0, 0, 30,
    0, 0, 1, 0, 30,
    0, 0, 0, 1, 0,
]);

function colorMatrixFixture() {
    const value = fixture();
    value.timelines.get(385).frames[0].operations[0].filters = [{
        kind: "color-matrix", matrix: [...COLOR_MATRIX], sourceType: "COLORMATRIXFILTER",
    }];
    return value;
}

async function main() {
    const adapter = new FlashLibrarySymbolAdapter();
    const content = adapter.parse(fixture());
    const text = content.root.children[0];
    assert.equal(text.textField.format.fontMode, "embedded");
    assert.deepEqual(text.textField.rasterization, {
        antiAliasType: "advanced", gridFitType: "subpixel", sharpness: 0, thickness: 0,
    });
    const fontAuthorityPlacementFixture = fixture();
    fontAuthorityPlacementFixture.timelines.get(385).frames[0].operations.unshift({
        op: "place", characterId: 18, depth: 0, move: false, ratio: 0,
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    });
    assert.deepEqual(adapter.parse(fontAuthorityPlacementFixture).root.children.map(child => child.textField?.sourceId), [203],
        "an inert font definition reference at reserved depth zero is not projected as display content");
    const transformedFontAuthorityFixture = fixture();
    transformedFontAuthorityFixture.timelines.get(385).frames[0].operations.unshift({
        op: "place", characterId: 18, depth: 0, move: false, ratio: 0,
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 0 },
    });
    assert.throws(() => adapter.parse(transformedFontAuthorityFixture),
        /FLASH_LIBRARY_NONVISUAL_FONT_PLACEMENT_UNSUPPORTED/,
        "a depth-zero font reference with display state remains fail-closed");
    for (const [gridFit, gridFitMode] of [[0, "none"], [1, "pixel"]]) {
        const gridFixture = fixture();
        gridFixture.library.assets[203].textRendering.gridFit = gridFit;
        gridFixture.library.assets[203].textRendering.gridFitMode = gridFitMode;
        assert.equal(adapter.parse(gridFixture).root.children[0].textField.rasterization.gridFitType, gridFitMode,
            `authenticated CSM grid-fit code ${gridFit} retains its exact Flash mode`);
    }
    const mismatchedGridFixture = fixture();
    mismatchedGridFixture.library.assets[203].textRendering.gridFit = 1;
    assert.throws(() => adapter.parse(mismatchedGridFixture), /FLASH_LIBRARY_TEXT_GRID_FIT_UNSUPPORTED/,
        "CSM grid-fit code and named mode must agree");
    for (const [tableHint, tableHintName] of [[0, "thin"], [2, "thick"]]) {
        const tableFixture = fixture();
        tableFixture.library.assets[18].fontAlignZones.tableHint = tableHint;
        tableFixture.library.assets[18].fontAlignZones.tableHintName = tableHintName;
        assert.deepEqual(adapter.parse(tableFixture).root.children[0].textField.format.embeddedFont.alignZones, {
            tableHint, tableHintName, zones: tableFixture.library.assets[18].fontAlignZones.zones,
        },
            `${tableHintName} alignment zones retain their exact table hint`);
    }
    const mismatchedTableFixture = fixture();
    mismatchedTableFixture.library.assets[18].fontAlignZones.tableHint = 0;
    assert.throws(() => adapter.parse(mismatchedTableFixture),
        /unsupported or mismatched table hint/);
    assert.deepEqual(adapter.parse(gradientFixture()).root.children[0].textField.filters[0], {
        kind: "gradient-bevel", distance: 10, angleRadians: Math.PI / 2, colors: [0xff3300, 0xffcc33, 0xffff33],
        alphas: [1, 0, 1], ratios: [29, 128, 255], blurX: 10, blurY: 10,
        strength: 2, quality: 3, type: "inner", knockout: false, compositeSource: true,
    });
    assert.deepEqual(adapter.parse(colorMatrixFixture()).root.children[0].textField.filters[0], {
        kind: "color-matrix", matrix: [...COLOR_MATRIX],
    });
    const nativeColorMatrix = createAuthoredFilters([{
        kind: "color-matrix", matrix: [...COLOR_MATRIX],
    }])[0];
    assert.equal(isColorMatrixFilter(nativeColorMatrix), true);
    assert.deepEqual(nativeColorMatrix.matrix, [...COLOR_MATRIX]);
    assert.throws(() => createAuthoredFilters([{
        kind: "color-matrix", matrix: COLOR_MATRIX.slice(0, 19),
    }]), /exactly 20 values/);
    const nativeGradient = createAuthoredFilters([{
        kind: "gradient-bevel", distance: 10, angleRadians: Math.PI / 2,
        colors: [0xff3300, 0xffcc33, 0xffff33], alphas: [1, 0, 1], ratios: [29, 128, 255],
        blurX: 10, blurY: 10, strength: 2, quality: 3, type: "inner", knockout: false, compositeSource: true,
    }])[0];
    assert.equal(isGradientBevelFilter(nativeGradient), true);
    assert.deepEqual({
        distance: nativeGradient.distance, angle: nativeGradient.angle,
        colors: nativeGradient.colors, alphas: nativeGradient.alphas, ratios: nativeGradient.ratios,
        blurX: nativeGradient.blurX, blurY: nativeGradient.blurY, strength: nativeGradient.strength,
        quality: nativeGradient.quality, type: nativeGradient.type, knockout: nativeGradient.knockout,
    }, {
        distance: 10, angle: 90, colors: [0xff3300, 0xffcc33, 0xffff33],
        alphas: [1, 0, 1], ratios: [29, 128, 255], blurX: 10, blurY: 10,
        strength: 2, quality: 3, type: "inner", knockout: false,
    });
    assert.deepEqual(text.textField.format.embeddedFont, {
        resourceId: "flash-font-18", sourceSha256: FONT_SHA, fontId: 18, fontType: "embedded", fontStyle: "bold",
        unitsPerEm: 20480, ascent: 18540, descent: 4340, leading: 2400,
        glyphs: [
            { index: 0, codePoint: 32, advance: 5700, bounds: { xmin: 0, xmax: 0, ymin: 0, ymax: 0 } },
            { index: 1, codePoint: 65, advance: 14800, bounds: { xmin: 0, xmax: 0, ymin: 0, ymax: 0 } },
            { index: 2, codePoint: 86, advance: 14800, bounds: { xmin: -10, xmax: 100, ymin: -20, ymax: 200 } },
        ],
        kerning: [...realShapedKerning(909)].sort((left, right) =>
            left.leftCodePoint - right.leftCodePoint || left.rightCodePoint - right.rightCodePoint),
        alignZones: {
            tableHint: 1, tableHintName: "medium",
            zones: [32, 65, 86].map((_codePoint, index) => ({
                data: [
                    { alignmentCoordinate: index / 10, alignmentCoordinateBits: index, range: 0, rangeBits: 0 },
                    { alignmentCoordinate: 0, alignmentCoordinateBits: 0, range: 1, rangeBits: 15360 },
                ],
                maskX: index !== 0, maskY: index !== 0,
            })),
        },
    });
    assert.deepEqual(content.resources.map(resource => [resource.id, resource.mediaType, resource.outputPath]), [
        ["flash-font-18", "font/ttf", "resources/flash-font-18.ttf"],
    ]);
    assert.equal(text.textField.format.embeddedFont.kerning.length, 909,
        "the full unsorted source kerning table is retained after deterministic normalization");

    const pixelFixture = fixture();
    pixelFixture.library.assets[203].textRendering.gridFit = 1;
    pixelFixture.library.assets[203].textRendering.gridFitMode = "pixel";
    const pixelText = adapter.parse(pixelFixture).root.children[0];
    assert.equal(pixelText.textField.rasterization.gridFitType, "pixel");

    const noOutlineFixture = fixture();
    noOutlineFixture.library.assets[18].font.kerning = realShapedKerning(908);
    noOutlineFixture.library.assets[203].textField.useOutlines = false;
    delete noOutlineFixture.library.assets[203].textRendering;
    const noOutlineText = adapter.parse(noOutlineFixture).root.children[0].textField;
    assert.equal(noOutlineText.useOutlines, false);
    assert.equal(noOutlineText.rasterization, undefined,
        "an authenticated non-outlined embedded field does not invent CSM rasterization");
    assert.equal(noOutlineText.format.fontMode, "embedded");
    assert.equal(noOutlineText.format.embeddedFont.kerning.length, 908,
        "the second real-sized unsorted source kerning table is retained");

    const noOutlineHtmlFixture = fixture();
    const noOutlineHtmlTextAsset = noOutlineHtmlFixture.library.assets[203];
    const noOutlineHtmlMarkup = '<p align="center"><font face="Arial" size="12" color="#ffffff" letterSpacing="0.000000" kerning="1">loading</font></p>';
    noOutlineHtmlTextAsset.initialText = noOutlineHtmlMarkup;
    noOutlineHtmlTextAsset.textField.html = true;
    noOutlineHtmlTextAsset.textField.initialText = noOutlineHtmlMarkup;
    noOutlineHtmlTextAsset.textField.useOutlines = false;
    delete noOutlineHtmlTextAsset.textRendering;
    const noOutlineHtmlText = adapter.parse(noOutlineHtmlFixture).root.children[0].textField;
    assert.equal(noOutlineHtmlText.useOutlines, false);
    assert.equal(noOutlineHtmlText.format.font, "Arial",
        "a non-outlined HTML field uses its exact device face even when the SWF also retains an embedded font");
    assert.equal(noOutlineHtmlText.format.fontMode, "embedded");
    assert.notEqual(noOutlineHtmlText.format.embeddedFont, undefined,
        "retained embedded metrics remain available without forcing Flash's outline rendering mode");

    const defaultOutlineFixture = fixture();
    delete defaultOutlineFixture.library.assets[203].textRendering;
    const defaultOutlineText = adapter.parse(defaultOutlineFixture).root.children[0].textField;
    assert.equal(defaultOutlineText.useOutlines, true);
    assert.equal(defaultOutlineText.rasterization, undefined,
        "an outlined embedded field without a CSMSettings tag must retain Flash's normal/pixel defaults");
    assert.equal(defaultOutlineText.format.fontMode, "embedded");

    const inputFixture = fixture();
    inputFixture.library.assets[203].textField.fieldType = "input";
    delete inputFixture.library.assets[203].textRendering;
    const inputText = adapter.parse(inputFixture).root.children[0].textField;
    assert.equal(inputText.type, "input");
    assert.equal(inputText.useOutlines, true);
    assert.equal(inputText.rasterization, undefined);
    assert.equal(inputText.format.fontMode, "embedded",
        "authenticated non-HTML input text must retain its embedded TrueType authority");

    const noLayoutFixture = fixture();
    const noLayoutFont = noLayoutFixture.library.assets[18].font;
    noLayoutFont.ascent = 0;
    noLayoutFont.descent = 0;
    noLayoutFont.hasLayout = false;
    noLayoutFont.kerning = [];
    noLayoutFont.leading = 0;
    noLayoutFont.bold = false;
    noLayoutFont.family = "MS PGothic";
    noLayoutFont.glyphs = noLayoutFont.glyphs.map(({ codePoint, index }) => ({ codePoint, index }));
    const noLayoutTextAsset = noLayoutFixture.library.assets[203];
    const noLayoutMarkup = '<p align="center"><font face="Arial" size="12" color="#ffffff" letterSpacing="0.000000" kerning="1">loading</font></p>';
    noLayoutTextAsset.initialText = noLayoutMarkup;
    noLayoutTextAsset.textField.html = true;
    noLayoutTextAsset.textField.initialText = noLayoutMarkup;
    noLayoutTextAsset.textField.useOutlines = false;
    delete noLayoutTextAsset.textRendering;
    const noLayoutContent = adapter.parse(noLayoutFixture);
    const noLayoutText = noLayoutContent.root.children[0].textField;
    assert.equal(noLayoutText.format.fontMode, "device");
    assert.equal(noLayoutText.format.font, "Arial",
        "the exact HTML face is the device-font authority when Flash retained no layout metrics");
    assert.equal(noLayoutText.format.embeddedFont, undefined);
    assert.deepEqual(noLayoutContent.resources, [],
        "a no-layout embedded outline is authenticated but not mispublished as a measurable native font");

    const emptyHtmlFixture = fixture();
    const emptyHtmlTextAsset = emptyHtmlFixture.library.assets[203];
    emptyHtmlTextAsset.initialText = '<p align="center"></p>';
    emptyHtmlTextAsset.textField.html = true;
    emptyHtmlTextAsset.textField.initialText = emptyHtmlTextAsset.initialText;
    const emptyHtmlContent = adapter.parse(emptyHtmlFixture);
    const emptyHtmlText = emptyHtmlContent.root.children[0].textField;
    assert.equal(emptyHtmlText.initialText, '<p align="center"></p>');
    assert.equal(emptyHtmlText.format.font, "Arial",
        "an empty HTML paragraph must inherit exact DefineEditText font authority");
    assert.equal(emptyHtmlText.format.align, "center");

    const hiddenPlacementFixture = fixture();
    hiddenPlacementFixture.timelines.get(385).frames[0].operations[0].visible = false;
    const hiddenPlacementContent = adapter.parse(hiddenPlacementFixture);
    assert.equal(hiddenPlacementContent.root.children[0].visible, false,
        "a retained PlaceObject visibility flag must project onto the native node");

    const description = describeNativeAuthoredFontCatalog(content, "nested/pet-house.lh");
    assert.equal(description.manifest.fonts[0].sourceUrl, "../resources/flash-font-18.ttf");
    assert.equal(description.definitions[0].className, "MC_PetHouse.__authoredFont_18_bold");

    const preparation = {
        content,
        hierarchy: {
            _$ver: 1, _$id: "root", _$type: "Sprite", name: "MC_PetHouse", width: 100, height: 20,
            _$child: [{
                _$id: "child", _$type: "Sprite", name: "TF_PetName", width: 100, height: 20,
            }],
        },
        prefabPath: "pet-house.lh",
        timelinePath: "pet-house.mc",
        timelineAssetId: "pet-house/pet-house.mc",
        timelineBytes: Uint8Array.of(1),
        resourceAssetIds: new Map([["flash-font-18", "pet-house/resources/flash-font-18.ttf"]]),
        resourcePayloads: new Map([["flash-font-18", TTF]]),
        sha256: sha,
    };
    const first = await prepareNativeLayaAuthoredContentBundle(preparation);
    const second = await prepareNativeLayaAuthoredContentBundle(preparation);
    assert.deepEqual(first.files.map(file => [file.path, file.kind]), [
        ["pet-house.font-manifest.json", "font-manifest"],
        ["pet-house.font-startup.json", "font-startup"],
        ["pet-house.lh", "prefab"],
        ["pet-house.mc", "timeline"],
        ["resources/flash-font-18.ttf", "font"],
    ]);
    assert.deepEqual(first.files.map(file => Buffer.from(file.bytes).toString("hex")),
        second.files.map(file => Buffer.from(file.bytes).toString("hex")));
    const hierarchy = JSON.parse(Buffer.from(first.files.find(file => file.kind === "prefab").bytes));
    const configuration = hierarchy._$child[0].authoredConfiguration;
    assert.equal(configuration.format.embeddedFont._$type, "any",
        "embedded font metadata is sealed for ObjDecoder");
    assert.equal(configuration.rasterization._$type, "any",
        "advanced rasterization metadata is sealed for ObjDecoder");
    assert.equal(configuration.format.embeddedFont.value.documentId, "flash-library-symbol-385");
    assert.equal(configuration.format.embeddedFont.value.sourceSha256, FONT_SHA);
    assert.deepEqual(hierarchy._$authoredContent.resources, [{
        id: "flash-font-18",
        assetId: "pet-house/resources/flash-font-18.ttf",
        outputPath: "resources/flash-font-18.ttf",
        mediaType: "font/ttf",
        byteLength: TTF.byteLength,
        sha256: FONT_SHA,
    }]);
    assert.deepEqual(hierarchy._$preloads, ["res://pet-house/pet-house.mc"]);
    const manifest = JSON.parse(Buffer.from(first.files.find(file => file.kind === "font-manifest").bytes));
    const startup = JSON.parse(Buffer.from(first.files.find(file => file.kind === "font-startup").bytes));
    assert.equal(manifest.fonts[0].sourceUrl, "resources/flash-font-18.ttf");
    assert.equal(startup.manifest.url, "pet-house.font-manifest.json");
    assert.equal(startup.manifest.sha256, sha(first.files.find(file => file.kind === "font-manifest").bytes));

    for (const [label, mutate, expected] of [
        ["device authority substitution", value => value.resources.get("assets\/18.ttf").mediaType = "image/png", /FLASH_LIBRARY_FONT_RESOURCE_AUTHORITY_MISSING/],
        ["nonembedded outlined font", value => value.library.assets[18].font.embedded = false, /FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED/],
        ["glyph order drift", value => value.library.assets[18].font.glyphs[1].codePoint = 31, /FLASH_LIBRARY_FONT_GLYPH_ORDER_UNSUPPORTED/],
        ["duplicate kerning pair", value => value.library.assets[18].font.kerning[1] = { ...value.library.assets[18].font.kerning[0] }, /FLASH_LIBRARY_FONT_KERNING_DUPLICATE/],
        ["unsupported rasterizer", value => value.library.assets[203].textRendering.renderer = "normal", /FLASH_LIBRARY_TEXT_RENDERER_UNSUPPORTED/],
        ["mismatched pixel grid fit", value => {
            value.library.assets[203].textRendering.gridFit = 1;
            value.library.assets[203].textRendering.gridFitMode = "subpixel";
        }, /FLASH_LIBRARY_TEXT_GRID_FIT_UNSUPPORTED/],
        ["unknown grid fit", value => {
            value.library.assets[203].textRendering.gridFit = 3;
            value.library.assets[203].textRendering.gridFitMode = "none";
        }, /FLASH_LIBRARY_TEXT_GRID_FIT_UNSUPPORTED/],
        ["no-layout outlined font", value => {
            const font = value.library.assets[18].font;
            font.ascent = 0; font.descent = 0; font.hasLayout = false; font.kerning = []; font.leading = 0;
            font.glyphs = font.glyphs.map(({ codePoint, index }) => ({ codePoint, index }));
        }, /FLASH_LIBRARY_FONT_LAYOUT_REQUIRED/],
        ["no-layout font with fabricated advance", value => {
            const font = value.library.assets[18].font;
            font.ascent = 0; font.descent = 0; font.hasLayout = false; font.kerning = []; font.leading = 0;
            font.glyphs = font.glyphs.map(({ codePoint, index }) => ({ codePoint, index }));
            font.glyphs[0].advance = 1;
            value.library.assets[203].textField.useOutlines = false;
            delete value.library.assets[203].textRendering;
        }, /FLASH_LIBRARY_FONT_LAYOUT_AUTHORITY_MISMATCH/],
        ["layout font HTML face mismatch", value => {
            value.library.assets[203].initialText = '<p align="center"><font face="Other" size="12" color="#ffffff" letterSpacing="0.000000" kerning="1">A</font></p>';
            value.library.assets[203].textField.html = true;
            value.library.assets[203].textField.initialText = value.library.assets[203].initialText;
        }, /FLASH_LIBRARY_TEXT_HTML_AUTHORITY_MISMATCH/],
    ]) {
        const value = fixture();
        mutate(value);
        assert.throws(() => adapter.parse(value), expected, label);
    }
    for (const [label, mutate, expected] of [
        ["gradient stop length", value => value.timelines.get(385).frames[0].operations[0].filters[0].ratios.pop(), /FLASH_LIBRARY_FILTER_STOPS_INVALID/],
        ["gradient stop range", value => value.timelines.get(385).frames[0].operations[0].filters[0].colors[0].alpha = 2, /FLASH_LIBRARY_FILTER_ALPHA_INVALID/],
        ["gradient type", value => value.timelines.get(385).frames[0].operations[0].filters[0].type = "sideways", /FLASH_LIBRARY_FILTER_TYPE_MISMATCH/],
        ["gradient quality", value => value.timelines.get(385).frames[0].operations[0].filters[0].passes = 16, /AUTHORED_CONTENT_GRADIENT_BEVEL_QUALITY_INVALID/],
    ]) {
        const value = gradientFixture();
        mutate(value);
        assert.throws(() => adapter.parse(value), expected, label);
    }
    await assert.rejects(
        prepareNativeLayaAuthoredContentBundle({
            ...preparation,
            resourcePayloads: new Map([["flash-font-18", new Uint8Array(TTF.byteLength)]]),
            sha256: () => FONT_SHA,
        }),
        /AUTHORED_CONTENT_FONT_RESOURCE_FORMAT_MISMATCH/,
    );
    process.stdout.write("authored embedded font: 35/35 passed\n");
}

function sha(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
});
