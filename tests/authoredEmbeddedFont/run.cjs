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
const { createAuthoredGlowFilters } = require(
    "../../src/extensions/authoredContent/runtime/AuthoredTextField.ts"
);
const { isGradientBevelFilter } = require(
    "../../src/layaAir/flash/filters/GradientBevelFilter.ts"
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

async function main() {
    const adapter = new FlashLibrarySymbolAdapter();
    const content = adapter.parse(fixture());
    const text = content.root.children[0];
    assert.equal(text.textField.format.fontMode, "embedded");
    assert.deepEqual(text.textField.rasterization, {
        antiAliasType: "advanced", gridFitType: "subpixel", sharpness: 0, thickness: 0,
    });
    const pixelFixture = fixture();
    pixelFixture.library.assets[203].textRendering.gridFit = 1;
    pixelFixture.library.assets[203].textRendering.gridFitMode = "pixel";
    assert.deepEqual(adapter.parse(pixelFixture).root.children[0].textField.rasterization, {
        antiAliasType: "advanced", gridFitType: "pixel", sharpness: 0, thickness: 0,
    });
    assert.deepEqual(adapter.parse(gradientFixture()).root.children[0].textField.filters[0], {
        kind: "gradient-bevel", distance: 10, angle: 90, colors: [0xff3300, 0xffcc33, 0xffff33],
        alphas: [1, 0, 1], ratios: [29, 128, 255], blurX: 10, blurY: 10,
        strength: 2, quality: 3, type: "inner", knockout: false,
    });
    const nativeGradient = createAuthoredGlowFilters([{
        kind: "gradient-bevel", distance: 10, angle: 90,
        colors: [0xff3300, 0xffcc33, 0xffff33], alphas: [1, 0, 1], ratios: [29, 128, 255],
        blurX: 10, blurY: 10, strength: 2, quality: 3, type: "inner", knockout: false,
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
        ["missing rasterization", value => delete value.library.assets[203].textRendering, /FLASH_LIBRARY_TEXT_RENDERING_REQUIRED/],
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
    ]) {
        const value = fixture();
        mutate(value);
        assert.throws(() => adapter.parse(value), expected, label);
    }
    for (const [label, mutate, expected] of [
        ["gradient stop length", value => value.timelines.get(385).frames[0].operations[0].filters[0].ratios.pop(), /FLASH_LIBRARY_FILTER_GRADIENT_INVALID/],
        ["gradient stop range", value => value.timelines.get(385).frames[0].operations[0].filters[0].colors[0].alpha = 2, /FLASH_LIBRARY_FILTER_COLOR_INVALID/],
        ["gradient type", value => value.timelines.get(385).frames[0].operations[0].filters[0].type = "sideways", /FLASH_LIBRARY_FILTER_TYPE_UNSUPPORTED/],
        ["gradient quality", value => value.timelines.get(385).frames[0].operations[0].filters[0].passes = 16, /FLASH_LIBRARY_FILTER_RANGE_INVALID/],
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
