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

const { FlashLibrarySymbolAdapter } = require(
    "../../src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts"
);

const place = (characterId, depth, extra = {}) => ({
    op: "place", characterId, depth, move: false, ratio: 0,
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    ...extra,
});
const replace = (characterId, depth) => ({ op: "place", characterId, depth, move: true, ratio: 0 });
const timeline = (symbolId, frameCount, frames, symbolName) => ({
    schema: "flash-timeline@1", symbolId, ...(symbolName ? { symbolName } : {}),
    frameRate: 30, frameCount, frames: frames.map((operations, index) => ({ index: index + 1, operations })),
});

function fixture() {
    return {
        library: {
            schema: "flash-library@1",
            assets: {
                "1": { characterId: 1, kind: "image", path: "assets/1.png" },
                "2": { characterId: 2, kind: "shape", path: "assets/1.png", bounds: { x: 0, y: 0, width: 12, height: 9 } },
                "3": { characterId: 3, kind: "image", path: "assets/3.png" },
                "4": { characterId: 4, kind: "shape", path: "assets/3.png", bounds: { x: 0, y: 0, width: 14, height: 10 } },
                "5": { characterId: 5, kind: "sprite", bounds: { x: 0, y: 0, width: 14, height: 10 } },
                "6": { characterId: 6, kind: "font", font: { family: "Device Sans", bold: false, italic: false } },
                "7": {
                    characterId: 7, kind: "input-text", bounds: { x: -2, y: -2, width: 20, height: 9 },
                    initialText: "Name", textField: {
                        align: "center", autoSize: false, border: false, color: { alpha: 1, color: 0xffcc00 },
                        fieldType: "dynamic", fontId: 6, fontSize: 12, html: false, indent: 0,
                        initialText: "Name", leading: 0, leftMargin: 0, multiline: false, password: false,
                        rightMargin: 0, selectable: false, useOutlines: false, variableName: "", wordWrap: false,
                    },
                },
                "8": { characterId: 8, kind: "sprite", symbolName: "ExportedClip", bounds: { x: -5, y: -2, width: 30, height: 18 } },
            },
            frameLabels: [],
            stage: { width: 700, height: 500, frameRate: 30, frameCount: 1, backgroundColor: { alpha: 1, color: 0xffffff } },
        },
        timelines: new Map([
            [5, timeline(5, 2, [[place(2, 1)], [replace(4, 1)]])],
            [8, timeline(8, 2, [[
                place(2, 1),
                place(5, 2, { name: "MC_Effect", matrix: { a: 1, b: 0, c: 0, d: 1, tx: -5, ty: 6 } }),
                place(7, 4, { name: "TF_Name", matrix: { a: 1, b: 0, c: 0, d: 1, tx: 8, ty: -2 } }),
            ], [replace(4, 1)]], "ExportedClip")],
        ]),
        entrySymbolId: 8,
        runtimeLinkage: "Fixture.Authored.ExportedClip",
        projection: "library-symbol",
        resources: new Map([
            ["assets/1.png", { sourcePath: "assets/1.png", mediaType: "image/png", byteLength: 4, sha256: "1".repeat(64) }],
            ["assets/3.png", { sourcePath: "assets/3.png", mediaType: "image/png", byteLength: 5, sha256: "3".repeat(64) }],
        ]),
    };
}

const content = new FlashLibrarySymbolAdapter().parse(fixture());
assert.equal(content.root.linkage, "ExportedClip");
assert.deepEqual([content.root.width, content.root.height], [30, 18]);
assert.deepEqual(content.stage, {
    width: 30, height: 18, frameRate: 30, frameCount: 2,
    backgroundColor: { alpha: 0, color: 0 },
});
assert.ok(content.root.children.some(child => child.name === "MC_Effect"));
assert.ok(content.root.children.some(child => child.name === "TF_Name"));
assert.equal(content.root.children.find(child => child.name === "MC_Effect").timeline.duration, 2 / 30);
assert.ok(content.timeline.tracks.some(track => track.targetPath.includes("character_2")));
assert.ok(content.timeline.tracks.some(track => track.targetPath.includes("character_4")));

const documentFixture = fixture();
documentFixture.projection = "document";
assert.deepEqual(new FlashLibrarySymbolAdapter().parse(documentFixture).stage.backgroundColor, { alpha: 1, color: 0xffffff });

process.stdout.write("authored library symbol projection: 10/10 passed\n");
