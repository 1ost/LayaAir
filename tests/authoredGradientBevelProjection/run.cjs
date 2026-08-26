"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
    });
    module._compile(output.outputText, filename);
};

const { FlashLibrarySymbolAdapter } = require(
    "../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts"
);

const matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const place = (characterId, depth, extra = {}) => ({
    op: "place", characterId, depth, move: false, ratio: 0, matrix, ...extra,
});
const caption = id => ({
    characterId: id, kind: "input-text", bounds: { x: 0, y: 0, width: 100, height: 20 }, initialText: "Ready",
    textField: {
        align: "center", autoSize: false, border: false, color: { alpha: 1, color: 0xffffff },
        fieldType: "dynamic", fontId: 2, fontSize: 12, html: false, indent: 0, initialText: "Ready",
        leading: 0, leftMargin: 0, multiline: false, password: false, rightMargin: 0,
        selectable: false, useOutlines: false, variableName: "", wordWrap: false,
    },
});
const gradientBevel = {
    angleRadians: Math.PI / 2, blurX: 10, blurY: 10,
    colors: [
        { alpha: 1, color: 0xff3300 }, { alpha: 0, color: 0xffcc33 }, { alpha: 1, color: 0xffff33 },
    ],
    compositeSource: true, distance: 3, innerShadow: true, kind: "gradient-bevel", knockout: false,
    onTop: false, passes: 2, ratios: [0, 128, 255], sourceType: "GRADIENTBEVELFILTER",
    strength: 4, type: "inner",
};

const request = {
    library: {
        schema: "flash-library@1",
        assets: {
            "2": { characterId: 2, kind: "font", font: { family: "Arial", bold: false, italic: false } },
            "3": caption(3), "4": caption(4), "5": caption(5),
            "6": {
                characterId: 6, kind: "text", initialText: "",
                staticText: { exactGlyphs: false, issues: ["SWF text records are missing"], matrix, runs: [] },
            },
            "9": { characterId: 9, kind: "sprite", symbolName: "PreparationFixture", bounds: { x: 0, y: 0, width: 100, height: 40 } },
        },
        frameLabels: [],
        stage: { width: 100, height: 40, frameRate: 24, frameCount: 3, backgroundColor: { alpha: 1, color: 0 } },
    },
    timelines: new Map([[9, {
        schema: "flash-timeline@1", symbolId: 9, symbolName: "PreparationFixture", frameRate: 24, frameCount: 3,
        frames: [
            { index: 1, operations: [place(3, 1, { name: "TF_Caption", filters: [gradientBevel] }), place(6, 2)] },
            { index: 2, operations: [{ op: "remove", depth: 1 }, place(4, 1, { name: "TF_Caption" })] },
            { index: 3, operations: [{ op: "remove", depth: 1 }, place(5, 1, { name: "TF_Caption" })] },
        ],
    }]]),
    entrySymbolId: 9,
    runtimeLinkage: "Fixture.PreparationFixture",
    resources: new Map(),
};

const content = new FlashLibrarySymbolAdapter().parse(request);
assert.equal(content.root.children.length, 4);
assert.equal(content.root.children.filter(child => child.name === "TF_Caption").length, 1);
assert.equal(new Set(content.root.children.map(child => child.instanceId)).size, 4);
const firstCaption = content.root.children.find(child => child.name === "TF_Caption");
assert.equal(firstCaption.variable, true);
assert.deepEqual(firstCaption.textField.filters, [{
    kind: "gradient-bevel", distance: 3, angleRadians: Math.PI / 2,
    colors: [0xff3300, 0xffcc33, 0xffff33], alphas: [1, 0, 1], ratios: [0, 128, 255],
    blurX: 10, blurY: 10, strength: 4, quality: 2, type: "inner", knockout: false, compositeSource: true,
}]);
const emptyText = content.root.children.find(child => child.linkage === "character_6");
assert.deepEqual([emptyText.kind, emptyText.width, emptyText.height, emptyText.children.length], ["container", 0, 0, 0]);
const drift = structuredClone(request);
drift.timelines = new Map(request.timelines);
drift.timelines.get(9).frames[0].operations[0].filters[0].sourceType = "BEVELFILTER";
assert.throws(() => new FlashLibrarySymbolAdapter().parse(drift), /FILTER_SOURCE_TYPE_UNSUPPORTED/);

process.stdout.write("authored gradient bevel projection: 9/9 passed\n");
