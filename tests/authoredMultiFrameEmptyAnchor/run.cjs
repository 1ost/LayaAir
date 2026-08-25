"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
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

const requestedRuntimeBundle = process.argv[2] === "--emit-runtime-bundle"
    ? path.resolve(process.argv[3] || "")
    : undefined;
if (process.argv.length > 2 && requestedRuntimeBundle === undefined)
    throw new Error("usage: node run.cjs [--emit-runtime-bundle <absolute-output-root>]");
if (requestedRuntimeBundle !== undefined && (!path.isAbsolute(requestedRuntimeBundle) || fs.existsSync(requestedRuntimeBundle)))
    throw new Error("runtime bundle output must be an absolute path which does not exist");

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 18 });
const emptyFrames = count => Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    operations: [],
}));

function sourceFixture() {
    return {
        library: {
            schema: "flash-library@1",
            assets: {
                "1": {
                    characterId: 1,
                    kind: "sprite",
                    symbolName: "RootClip",
                    bounds: { x: 0, y: 0, width: 80, height: 60 },
                },
                "2": {
                    characterId: 2,
                    kind: "sprite",
                    bounds: { x: 0, y: 0, width: 4, height: 4 },
                },
                "11": { characterId: 11, kind: "sprite", symbolName: "AnchorClip" },
            },
            frameLabels: [],
            stage: {
                width: 80,
                height: 60,
                frameRate: 30,
                frameCount: 1,
                backgroundColor: { alpha: 1, color: 0 },
            },
        },
        timelines: new Map([
            [1, {
                schema: "flash-timeline@1",
                symbolId: 1,
                symbolName: "RootClip",
                frameRate: 30,
                frameCount: 1,
                frames: [{
                    index: 1,
                    operations: [{
                        op: "place",
                        characterId: 11,
                        depth: 1,
                        move: false,
                        ratio: 0,
                        name: "Girl_MountPointIcon",
                        matrix: matrix(),
                    }],
                }],
            }],
            [2, {
                schema: "flash-timeline@1",
                symbolId: 2,
                frameRate: 30,
                frameCount: 1,
                frames: [{ index: 1, operations: [] }],
            }],
            [11, {
                schema: "flash-timeline@1",
                symbolId: 11,
                symbolName: "AnchorClip",
                frameRate: 30,
                frameCount: 4,
                frames: emptyFrames(4),
            }],
        ]),
    };
}

function requestFrom(source) {
    return {
        ...source,
        entrySymbolId: 1,
        runtimeLinkage: "Fixture.Authored.RootClip",
        projection: "library-symbol",
        resources: new Map(),
    };
}

function cloneSource(source) {
    return {
        library: structuredClone(source.library),
        timelines: new Map([...source.timelines].map(([id, timeline]) => [id, structuredClone(timeline)])),
    };
}

const adapter = new FlashLibrarySymbolAdapter();
const source = sourceFixture();
const content = adapter.parse(requestFrom(source));
const anchor = content.root.children[0];
assert.deepEqual(
    {
        linkage: anchor.linkage,
        name: anchor.name,
        kind: anchor.kind,
        width: anchor.width,
        height: anchor.height,
        variable: anchor.variable,
        children: anchor.children.length,
    },
    {
        linkage: "AnchorClip",
        name: "Girl_MountPointIcon",
        kind: "container",
        width: 0,
        height: 0,
        variable: true,
        children: 0,
    },
    "the empty anchor lost its authored name/reflection identity or gained geometry",
);
assert.deepEqual(
    {
        frameRate: anchor.timeline.frameRate,
        duration: anchor.timeline.duration,
        loop: anchor.timeline.loop,
        tracks: anchor.timeline.tracks.length,
    },
    { frameRate: 30, duration: 4 / 30, loop: true, tracks: 0 },
    "the empty anchor did not retain its independent four-frame clock",
);

for (const [label, mutate, expected] of [
    ["unnamed bounds-less timeline", value => {
        delete value.timelines.get(1).frames[0].operations[0].name;
    }, /FLASH_LIBRARY_SPRITE_BOUNDS_MISSING/],
    ["display operation on a later frame", value => {
        value.timelines.get(11).frames[3].operations.push({
            op: "place", characterId: 2, depth: 1, move: false, ratio: 0, matrix: matrix(),
        });
    }, /FLASH_LIBRARY_SPRITE_BOUNDS_MISSING/],
    ["frame label on a later frame", value => {
        value.timelines.get(11).frames[3].label = "visible";
        value.timelines.get(11).frames[3].operations.push({ op: "label", name: "visible" });
    }, /FLASH_LIBRARY_SPRITE_BOUNDS_MISSING/],
    ["unclosed empty timeline", value => {
        value.timelines.get(11).frames.pop();
    }, /FLASH_LIBRARY_FRAME_CLOSURE/],
]) {
    const invalid = cloneSource(source);
    mutate(invalid);
    assert.throws(() => adapter.parse(requestFrom(invalid)), expected, label);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "laya-empty-anchor-"));
try {
    const sourceRoot = path.join(temporaryRoot, "source");
    fs.mkdirSync(path.join(sourceRoot, "timelines"), { recursive: true });
    const serializableLibrary = structuredClone(source.library);
    serializableLibrary.timelines = {
        "1": "timelines/1.timeline.json",
        "2": "timelines/2.timeline.json",
        "11": "timelines/11.timeline.json",
    };
    fs.writeFileSync(path.join(sourceRoot, "library.json"), `${JSON.stringify(serializableLibrary, null, 2)}\n`);
    for (const [id, timeline] of source.timelines)
        fs.writeFileSync(path.join(sourceRoot, "timelines", `${id}.timeline.json`), `${JSON.stringify(timeline, null, 2)}\n`);

    const emittedRoots = [requestedRuntimeBundle ?? path.join(temporaryRoot, "bundle-a"), path.join(temporaryRoot, "bundle-b")];
    for (const outputRoot of emittedRoots) {
        execFileSync(process.execPath, [
            path.resolve(__dirname, "../../src/extensions/authoredContent/scripts/emitFlashLibrarySymbolBundle.cjs"),
            sourceRoot,
            outputRoot,
            "1",
            "Fixture.Authored.RootClip",
            "empty-anchor",
            "library-symbol",
        ], { cwd: path.resolve(__dirname, "../.."), stdio: "pipe", env: process.env });
    }

    const fileAuthority = root => fs.readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
        .sort()
        .map(relative => ({
            relative,
            sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex"),
        }));
    assert.deepEqual(fileAuthority(emittedRoots[0]), fileAuthority(emittedRoots[1]), "emission was not deterministic");

    const hierarchy = JSON.parse(fs.readFileSync(path.join(emittedRoots[0], "empty-anchor.lh"), "utf8"));
    const emittedAnchor = hierarchy._$child[0];
    assert.equal(emittedAnchor.name, "Girl_MountPointIcon", "native hierarchy lost the instance name");
    assert.equal(emittedAnchor._$var, true, "native hierarchy lost named-instance reflection");
    assert.equal(emittedAnchor.width, 0, "native hierarchy invented anchor width");
    assert.equal(emittedAnchor.height, 0, "native hierarchy invented anchor height");
    assert.equal(emittedAnchor._$runtime, "Laya.AuthoredContent.MovieClip", "anchor lost MovieClip playback ownership");
    assert.equal(emittedAnchor._$comp.length, 1, "anchor did not receive exactly one independent animator");
    assert.match(emittedAnchor._$comp[0].clip._$uuid, /^res:\/\//, "anchor timeline asset identity was not sealed");
    assert.equal(hierarchy._$authoredContent.nodes[1].instanceName, "Girl_MountPointIcon", "metadata lost reflection identity");
    assert.equal(hierarchy._$authoredContent.nestedTimelines.length, 1, "nested timeline closure drifted");
    assert.deepEqual(
        hierarchy._$authoredContent.nestedTimelines[0].semanticPath,
        ["RootClip", "AnchorClip"],
        "nested playback semantic path drifted",
    );
}
finally {
    assert.ok(temporaryRoot.startsWith(path.join(os.tmpdir(), "laya-empty-anchor-")));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("authored multi-frame empty anchor: 15/15 passed\n");
