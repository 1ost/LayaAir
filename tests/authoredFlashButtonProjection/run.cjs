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

const matrix = (a = 1, d = 1, tx = 0, ty = 0) => ({ a, b: 0, c: 0, d, tx, ty });
const color = alphaMultiplier => ({
    redMultiplier: 1, redOffset: 0,
    greenMultiplier: 1, greenOffset: 0,
    blueMultiplier: 1, blueOffset: 0,
    alphaMultiplier, alphaOffset: 0,
});
const authority = (id, digit) => ({
    sourcePath: `shapes/${id}.png`, mediaType: "image/png", byteLength: 1, sha256: digit.repeat(64),
});

function fixture() {
    return {
        library: {
            schema: "flash-library@1",
            assets: {
                "5": { characterId: 5, kind: "shape", bounds: { x: 0, y: 0, width: 20, height: 20 } },
                "7": { characterId: 7, kind: "shape", bounds: { x: 0, y: 0, width: 20, height: 20 } },
                "9": { characterId: 9, kind: "shape", bounds: { x: 0, y: 0, width: 20, height: 20 } },
                "10": {
                    characterId: 10,
                    kind: "button",
                    symbolName: "CloseButton",
                    bounds: { x: 0, y: 0, width: 20, height: 20 },
                    button: {
                        hasActions: false,
                        trackAsMenu: false,
                        records: [
                            { characterId: 5, depth: 1, states: ["up", "hitTest"], matrix: matrix(), colorTransform: color(1) },
                            { characterId: 7, depth: 1, states: ["over"], matrix: matrix(0.5, 0.75, 2, 3), colorTransform: color(0.5) },
                            { characterId: 9, depth: 1, states: ["down"], matrix: matrix(), colorTransform: color(1) },
                        ],
                    },
                },
                "20": { characterId: 20, kind: "sprite", symbolName: "ButtonHost", bounds: { x: 0, y: 0, width: 100, height: 50 } },
            },
            frameLabels: [],
            stage: { width: 100, height: 50, frameRate: 30, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
        },
        timelines: new Map([[20, {
            schema: "flash-timeline@1",
            symbolId: 20,
            symbolName: "ButtonHost",
            frameRate: 30,
            frameCount: 1,
            frames: [{ index: 1, operations: [{
                op: "place", characterId: 10, depth: 3, move: false, ratio: 0,
                name: "Btn_Close", matrix: matrix(1, 1, 11, 12),
            }] }],
        }]]),
        entrySymbolId: 20,
        runtimeLinkage: "Bleach.Authored.ButtonHost",
        resources: new Map(),
        rasterizedShapes: new Map([
            [5, authority(5, "5")],
            [7, authority(7, "7")],
            [9, authority(9, "9")],
        ]),
        projection: "library-symbol",
    };
}

const adapter = new FlashLibrarySymbolAdapter();
const content = adapter.parse(fixture());
const button = content.root.children[0];
assert.deepEqual(
    { kind: button.kind, linkage: button.linkage, name: button.name, depth: button.depth, x: button.x, y: button.y,
        width: button.width, height: button.height, variable: button.variable },
    { kind: "button", linkage: "CloseButton", name: "Btn_Close", depth: 3, x: 11, y: 12,
        width: 20, height: 20, variable: true },
);
assert.deepEqual(button.children.map(state => [state.kind, state.name]), [
    ["button-state", "upState"], ["button-state", "overState"],
    ["button-state", "downState"], ["button-state", "hitTestState"],
]);
assert.deepEqual(button.children.map(state => state.children.map(child => [child.linkage, child.depth])), [
    [["character_5", 1]], [["character_7", 1]], [["character_9", 1]], [["character_5", 1]],
]);
assert.notStrictEqual(button.children[0], button.children[3]);
assert.notStrictEqual(button.children[0].children[0], button.children[3].children[0],
    "one shared source character must project to separately owned up and hit instances");
assert.deepEqual(
    { x: button.children[1].children[0].x, y: button.children[1].children[0].y,
        matrix: button.children[1].children[0].matrix, alpha: button.children[1].children[0].alpha },
    { x: 2, y: 3, matrix: { a: 0.5, b: 0, c: 0, d: 0.75 }, alpha: 0.5 },
);
assert.deepEqual(content.resources.map(resource => resource.sourcePath), ["shapes/5.png", "shapes/7.png", "shapes/9.png"]);

const emptyHitFixture = fixture();
emptyHitFixture.library.assets["10"].button.records[0].states = ["up"];
const emptyHitButton = adapter.parse(emptyHitFixture).root.children[0];
assert.deepEqual(emptyHitButton.children.map(state => state.children.length), [1, 1, 1, 0],
    "an absent hit state must remain an independently owned empty state without an up-state fallback");

const emptyVisualFixture = fixture();
emptyVisualFixture.library.assets["10"].button.records.splice(1, 1);
const emptyVisualButton = adapter.parse(emptyVisualFixture).root.children[0];
assert.deepEqual(emptyVisualButton.children.map(state => state.children.length), [1, 0, 1, 1],
    "an absent visual state must remain independently empty without copying another visual state");

const emptyButtonFixture = fixture();
emptyButtonFixture.library.assets["10"].button.records = [];
const emptyButton = adapter.parse(emptyButtonFixture).root.children[0];
assert.deepEqual(emptyButton.children.map(state => [state.name, state.children.length]), [
    ["upState", 0], ["overState", 0], ["downState", 0], ["hitTestState", 0],
], "an entirely empty source button must still publish four distinct canonical state roots");
assert.equal(new Set(emptyButton.children).size, 4);

for (const [label, mutate, expected] of [
    ["action records", value => value.library.assets["10"].button.hasActions = true, /FLASH_LIBRARY_BUTTON_ACTIONS_UNSUPPORTED/],
    ["menu tracking", value => value.library.assets["10"].button.trackAsMenu = true, /FLASH_LIBRARY_BUTTON_MENU_UNSUPPORTED/],
    ["unknown state", value => value.library.assets["10"].button.records[0].states = ["disabled"], /FLASH_LIBRARY_BUTTON_STATE_UNSUPPORTED/],
    ["duplicate record state", value => value.library.assets["10"].button.records[0].states = ["up", "up"], /FLASH_LIBRARY_BUTTON_STATE_DUPLICATE/],
    ["duplicate state depth", value => value.library.assets["10"].button.records.push({
        characterId: 7, depth: 1, states: ["up"], matrix: matrix(), colorTransform: color(1),
    }), /FLASH_LIBRARY_BUTTON_DEPTH_DUPLICATE/],
    ["missing state", value => value.library.assets["10"].button.records[2].states = [], /FLASH_LIBRARY_BUTTON_STATE_REQUIRED/],
    ["unknown record field", value => value.library.assets["10"].button.records[0].blendMode = "normal", /FLASH_LIBRARY_BUTTON_RECORD_FIELD_UNSUPPORTED/],
    ["missing record matrix", value => delete value.library.assets["10"].button.records[0].matrix, /FLASH_LIBRARY_OBJECT_REQUIRED/],
    ["RGB color transform", value => value.library.assets["10"].button.records[0].colorTransform.redMultiplier = 0.5, /FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED/],
    ["nonzero bounds origin", value => value.library.assets["10"].bounds.x = 1, /FLASH_LIBRARY_BUTTON_BOUNDS_UNSUPPORTED/],
]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => adapter.parse(value), expected, label);
}

process.stdout.write("authored Flash button projection: 18/18 passed\n");
