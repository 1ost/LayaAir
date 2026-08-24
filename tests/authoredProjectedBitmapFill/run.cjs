"use strict";

const assert = require("node:assert/strict");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
    const source = require("node:fs").readFileSync(filename, "utf8");
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

const bounds = { x: -50.95, y: -32, width: 103, height: 64 };
const rectangle = [
    [[52.05, 32], [-50.95, 32]],
    [[-50.95, 32], [-50.95, -32]],
    [[-50.95, -32], [52.05, -32]],
    [[52.05, -32], [52.05, 32]],
].map(([from, to]) => ({
    kind: "line", fillStyle0: 0, fillStyle1: 2, lineStyle: 0,
    start: { from, to }, end: { from, to },
}));

function fixture(resourcePath = "assets/1.png", mediaType = "image/png") {
    return {
        library: {
            schema: "flash-library@1",
            assets: {
                "2": {
                    characterId: 2, kind: "shape", placeholder: true, bounds,
                    shape: {
                        fillStyles: [
                            { kind: "bitmap", bitmapId: 65535, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 } },
                            { kind: "bitmap", bitmapId: 1, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: bounds.x, ty: bounds.y } },
                        ],
                        lineStyles: [], segments: structuredClone(rectangle), usesFillWindingRule: false,
                    },
                },
                "3": { characterId: 3, kind: "sprite", symbolName: "BootShadow", bounds },
                "4": { characterId: 4, kind: "sprite", bounds },
            },
            frameLabels: [],
            stage: { width: 550, height: 400, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0xffffff } },
        },
        timelines: new Map([
            [3, {
                schema: "flash-timeline@1", symbolId: 3, symbolName: "BootShadow", frameRate: 24, frameCount: 1,
                frames: [{ index: 1, operations: [
                    { op: "place", characterId: 2, depth: 1, move: false, ratio: 0, matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } },
                    { op: "place", characterId: 4, depth: 2, move: false, ratio: 0, name: "mc_hp", matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } },
                ] }],
            }],
            [4, {
                schema: "flash-timeline@1", symbolId: 4, frameRate: 24, frameCount: 1,
                frames: [{ index: 1, operations: [{ op: "place", characterId: 2, depth: 1, move: false, ratio: 0, matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } }] }],
            }],
        ]),
        entrySymbolId: 3,
        runtimeLinkage: "Bleach.Authored.BootShadow",
        resources: new Map([[resourcePath, { sourcePath: resourcePath, mediaType, byteLength: 3265, sha256: "e5bbb339a224febb1ca67486bd0d8943ccaeb153ca385e3c58554e925152f12f" }]]),
    };
}

const adapter = new FlashLibrarySymbolAdapter();
const content = adapter.parse(fixture());
assert.equal(content.root.linkage, "BootShadow");
assert.equal(content.root.runtimeLinkage, "Bleach.Authored.BootShadow");
assert.deepEqual([content.root.width, content.root.height], [103, 64]);
assert.deepEqual([content.stage.width, content.stage.height], [103, 64]);
assert.equal(content.resources[0].sourcePath, "assets/1.png");
assert.equal(content.root.children[0].resourceId, "flash-character-2");
assert.deepEqual([content.root.children[0].x, content.root.children[0].y], [-50.95, -32]);
assert.equal(content.root.children[1].linkage, "character_4");
assert.equal(content.root.children[1].name, "mc_hp");
assert.equal(content.timeline.tracks.length, 0);

const jpegContent = adapter.parse(fixture("assets/1.jpg", "image/jpeg"));
assert.equal(jpegContent.resources[0].sourcePath, "assets/1.jpg");

const jpegExtensionContent = adapter.parse(fixture("assets/1.jpeg", "image/jpeg"));
assert.equal(jpegExtensionContent.resources[0].sourcePath, "assets/1.jpeg");

for (const [label, mutate, expected] of [
    ["scaled bitmap", value => value.library.assets["2"].shape.fillStyles[1].startMatrix.a = 19, /FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED/],
    ["non-rectangular edge", value => value.library.assets["2"].shape.segments[0].end.to = [0, 0], /FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED/],
    ["missing bitmap authority", value => value.resources.clear(), /FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED/],
    ["bitmap media mismatch", value => value.resources.get("assets/1.png").mediaType = "image/jpeg", /FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED/],
    ["ambiguous image authority", value => value.resources.set("assets/1.jpg", { ...value.resources.get("assets/1.png"), sourcePath: "assets/1.jpg", mediaType: "image/jpeg" }), /FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED/],
    ["second real fill", value => value.library.assets["2"].shape.fillStyles.push({ ...value.library.assets["2"].shape.fillStyles[1], bitmapId: 4 }), /FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED/],
]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => adapter.parse(value), expected, label);
}

process.stdout.write("authored projected bitmap fill: 9/9 passed\n");
