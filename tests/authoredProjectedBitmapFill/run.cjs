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

function tileEdges(x, y, width, height, fillStyle1) {
    return [
        [[x + width, y + height], [x, y + height]],
        [[x, y + height], [x, y]],
        [[x, y], [x + width, y]],
        [[x + width, y], [x + width, y + height]],
    ].map(([from, to]) => ({
        kind: "line", fillStyle0: 0, fillStyle1, lineStyle: 0,
        start: { from, to }, end: { from, to },
    }));
}

function fixture(resourcePath = "assets/1.png", mediaType = "image/png") {
    return {
        library: {
            schema: "flash-library@1",
            assets: {
                "1": { characterId: 1, kind: "image", path: resourcePath },
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

function mosaicFixture() {
    const value = fixture();
    const mosaicBounds = { x: 0, y: 0, width: 100, height: 60 };
    value.library.assets["3"].bounds = mosaicBounds;
    value.library.assets["2"].bounds = mosaicBounds;
    value.library.assets["2"].shape.fillStyles = [
        { kind: "bitmap", bitmapId: 1, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 } },
        { kind: "bitmap", bitmapId: 65535, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 } },
        { kind: "bitmap", bitmapId: 5, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 10 } },
        { kind: "bitmap", bitmapId: 65535, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 } },
        { kind: "bitmap", bitmapId: 6, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 15, ty: 10 } },
    ];
    value.library.assets["2"].shape.segments = [
        ...tileEdges(0, 0, 100, 10, 1),
        ...tileEdges(0, 10, 20, 50, 3),
        ...tileEdges(15, 10, 85, 50, 5),
    ];
    value.library.assets["5"] = { characterId: 5, kind: "image", path: "assets/5.png" };
    value.library.assets["6"] = { characterId: 6, kind: "image", path: "assets/6.jpg" };
    value.resources.set("assets/5.png", { sourcePath: "assets/5.png", mediaType: "image/png", byteLength: 40, sha256: "5".repeat(64) });
    value.resources.set("assets/6.jpg", { sourcePath: "assets/6.jpg", mediaType: "image/jpeg", byteLength: 50, sha256: "6".repeat(64) });
    value.timelines.get(3).frames[0].operations.splice(1);
    return value;
}

function mixedSolidFixture() {
    const value = fixture();
    const shapeBounds = { x: 0, y: 0, width: 100, height: 100 };
    value.library.assets["2"].bounds = shapeBounds;
    value.library.assets["3"].bounds = shapeBounds;
    value.library.assets["2"].shape.fillStyles = [
        { kind: "bitmap", bitmapId: 1, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 } },
        { kind: "solid", startColor: { alpha: 1, color: 0x972aa9 }, endColor: { alpha: 1, color: 0x972aa9 } },
        { kind: "solid", startColor: { alpha: 0.5, color: 0 }, endColor: { alpha: 0.5, color: 0 } },
    ];
    value.library.assets["2"].shape.segments = [
        ...tileEdges(0, 0, 100, 100, 1),
        ...tileEdges(20, 20, 60, 60, 3).map(edge => ({ ...edge, fillStyle0: 2 })),
        ...tileEdges(10, 10, 80, 80, 2),
    ];
    value.library.assets["2"].bitmapFillRuntime = {
        bitmapCharacterIds: [1], projection: "rectangular-mosaic",
        visualAuthority: "bitmap-character-export",
        solidFillStyles: [
            {
                alpha: 1, color: 0x972aa9, path: "assets/2-solid-fill-2.png", styleIndex: 2,
                rectangles: [
                    { x: 10, y: 10, width: 80, height: 10 },
                    { x: 10, y: 20, width: 10, height: 60 },
                    { x: 80, y: 20, width: 10, height: 60 },
                    { x: 10, y: 80, width: 80, height: 10 },
                ],
            },
            {
                alpha: 0.5, color: 0, path: "assets/2-solid-fill-3.png", styleIndex: 3,
                rectangles: [{ x: 20, y: 20, width: 60, height: 60 }],
            },
        ],
    };
    value.resources.set("assets/2-solid-fill-2.png", {
        sourcePath: "assets/2-solid-fill-2.png", mediaType: "image/png", byteLength: 69, sha256: "2".repeat(64),
    });
    value.resources.set("assets/2-solid-fill-3.png", {
        sourcePath: "assets/2-solid-fill-3.png", mediaType: "image/png", byteLength: 69, sha256: "3".repeat(64),
    });
    value.timelines.get(3).frames[0].operations.splice(1);
    return value;
}

function solidBackedBitmapFixture() {
    const value = fixture();
    const shapeBounds = { x: 0, y: 0, width: 100, height: 20 };
    value.library.assets["2"].bounds = shapeBounds;
    value.library.assets["3"].bounds = shapeBounds;
    value.library.assets["2"].shape.fillStyles = [
        { kind: "solid", startColor: { alpha: 1, color: 0x202020 }, endColor: { alpha: 1, color: 0x202020 } },
        { kind: "bitmap", bitmapId: 1, repeat: false, smooth: false, startMatrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 } },
    ];
    value.library.assets["2"].shape.segments = [
        ...tileEdges(0, 0, 100, 20, 1),
        ...tileEdges(0, 0, 10, 20, 2),
    ];
    value.library.assets["2"].bitmapFillRuntime = {
        bitmapCharacterIds: [1], projection: "rectangular-mosaic",
        visualAuthority: "bitmap-character-export",
        solidFillStyles: [{
            alpha: 1, color: 0x202020, path: "assets/2-solid-fill-1.png", styleIndex: 1,
            rectangles: [{ x: 0, y: 0, width: 100, height: 20 }],
        }],
    };
    value.resources.set("assets/2-solid-fill-1.png", {
        sourcePath: "assets/2-solid-fill-1.png", mediaType: "image/png", byteLength: 69, sha256: "4".repeat(64),
    });
    value.timelines.get(3).frames[0].operations.splice(1);
    return value;
}

const adapter = new FlashLibrarySymbolAdapter();
const content = adapter.parse(fixture());
assert.equal(content.root.linkage, "BootShadow");
assert.equal(content.root.runtimeLinkage, "Bleach.Authored.BootShadow");
assert.deepEqual([content.root.width, content.root.height], [103, 64]);
assert.deepEqual([content.stage.width, content.stage.height], [103, 64]);
assert.equal(content.resources[0].sourcePath, "assets/1.png");
assert.equal(content.root.children[0].resourceId, "flash-bitmap-1");
assert.equal(content.root.children[0].smoothing, false);
assert.deepEqual([content.root.children[0].x, content.root.children[0].y], [-50.95, -32]);
assert.equal(content.root.children[1].linkage, "character_4");
assert.equal(content.root.children[1].name, "mc_hp");
assert.equal(content.timeline.tracks.length, 0);

const smoothFixture = fixture();
smoothFixture.library.assets["2"].shape.fillStyles[1].smooth = true;
const smoothProjection = adapter.parse(smoothFixture).root.children[0];
assert.equal(smoothProjection.resourceId, "flash-bitmap-1-smooth");
assert.equal(smoothProjection.smoothing, true);

const jpegContent = adapter.parse(fixture("assets/1.jpg", "image/jpeg"));
assert.equal(jpegContent.resources[0].sourcePath, "assets/1.jpg");
assert.equal(jpegContent.resources[0].mediaType, "image/jpeg");
assert.equal(jpegContent.resources[0].outputPath, "resources/flash-bitmap-1.jpg");

const jpegExtensionContent = adapter.parse(fixture("assets/1.jpeg", "image/jpeg"));
assert.equal(jpegExtensionContent.resources[0].sourcePath, "assets/1.jpeg");
assert.equal(jpegExtensionContent.resources[0].outputPath, "resources/flash-bitmap-1.jpg");

const mosaicContent = adapter.parse(mosaicFixture());
const mosaic = mosaicContent.root.children[0];
assert.equal(mosaic.kind, "container");
assert.deepEqual(mosaic.children.map(child => [child.x, child.y, child.width, child.height]), [
    [0, 0, 100, 10], [0, 10, 20, 50], [15, 10, 85, 50],
]);
assert.deepEqual(mosaic.children.map(child => child.resourceId), [
    "flash-bitmap-1", "flash-bitmap-5", "flash-bitmap-6",
]);
assert.deepEqual(mosaic.children.map(child => child.smoothing), [false, false, false]);

const mixedContent = adapter.parse(mixedSolidFixture());
const mixed = mixedContent.root.children[0];
assert.equal(mixed.kind, "container");
assert.deepEqual(mixed.children.map(child => [child.x, child.y, child.width, child.height, child.alpha]), [
    [0, 0, 100, 100, undefined],
    [10, 10, 80, 10, 1],
    [10, 20, 10, 60, 1],
    [80, 20, 10, 60, 1],
    [10, 80, 80, 10, 1],
    [20, 20, 60, 60, 0.5],
]);
assert.deepEqual(mixed.children.map(child => child.resourceId), [
    "flash-bitmap-1",
    "flash-solid-fill-2-2", "flash-solid-fill-2-2", "flash-solid-fill-2-2", "flash-solid-fill-2-2",
    "flash-solid-fill-2-3",
]);
const solidBacked = adapter.parse(solidBackedBitmapFixture()).root.children[0];
assert.equal(solidBacked.kind, "container");
assert.deepEqual(solidBacked.children.map(child => [child.x, child.y, child.width, child.height]), [
    [0, 0, 100, 20], [0, 0, 10, 20],
]);
assert.deepEqual(solidBacked.children.map(child => child.resourceId), [
    "flash-solid-fill-2-1", "flash-bitmap-1",
]);
const mixedDrift = mixedSolidFixture();
mixedDrift.library.assets["2"].bitmapFillRuntime.solidFillStyles[0].rectangles[0].width = 79;
assert.throws(() => adapter.parse(mixedDrift), /FLASH_LIBRARY_SOLID_FILL_AUTHORITY_MISMATCH/);

const incompleteMosaic = mosaicFixture();
incompleteMosaic.library.assets["2"].shape.segments.splice(0, 4, ...tileEdges(0, 0, 99, 10, 1));
incompleteMosaic.library.assets["2"].shape.segments.splice(-4, 4, ...tileEdges(15, 10, 84, 50, 5));
assert.throws(() => adapter.parse(incompleteMosaic), /FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED/);

const scaledFixture = fixture();
scaledFixture.library.assets["1"].bitmap = { width: 125, height: 17 };
scaledFixture.library.assets["2"].bounds = { x: 0, y: 0, width: 80, height: 17 };
scaledFixture.library.assets["3"].bounds = { x: 0, y: 0, width: 80, height: 17 };
scaledFixture.library.assets["2"].shape.fillStyles[1].startMatrix = { a: 12.8, b: 0, c: 0, d: 20, tx: 0, ty: 0 };
scaledFixture.library.assets["2"].shape.segments = tileEdges(0, 0, 80, 17, 2);
const scaled = adapter.parse(scaledFixture).root.children[0];
assert.deepEqual([scaled.width, scaled.height], [80, 17]);

const dimensionDrift = structuredClone(scaledFixture);
dimensionDrift.library.assets["1"].bitmap.width = 124;
assert.throws(() => adapter.parse(dimensionDrift), /FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED/);

for (const [label, mutate, expected] of [
    ["scaled bitmap", value => value.library.assets["2"].shape.fillStyles[1].startMatrix.a = 19, /FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED/],
    ["non-rectangular edge", value => value.library.assets["2"].shape.segments[0].end.to = [0, 0], /FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED/],
    ["missing bitmap authority", value => value.resources.clear(), /FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED/],
    ["bitmap media mismatch", value => value.resources.get("assets/1.png").mediaType = "image/jpeg", /FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED/],
    ["same-stem authority cannot replace exact image asset", value => { value.library.assets["1"].path = "nested/1.png"; }, /FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED/],
    ["second real fill without geometry", value => value.library.assets["2"].shape.fillStyles.push({ ...value.library.assets["2"].shape.fillStyles[1], bitmapId: 4 }), /FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED/],
]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => adapter.parse(value), expected, label);
}

process.stdout.write("authored projected bitmap fill: 19/19 passed\n");
