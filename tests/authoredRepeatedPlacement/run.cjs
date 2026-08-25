"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const requestedRuntimeBundle = process.argv[2] === "--emit-runtime-bundle"
    ? path.resolve(process.argv[3] || "")
    : undefined;
if (process.argv.length > 2 && requestedRuntimeBundle === undefined)
    throw new Error("usage: node run.cjs [--emit-runtime-bundle <absolute-output-root>]");
if (requestedRuntimeBundle !== undefined && (!path.isAbsolute(requestedRuntimeBundle) || fs.existsSync(requestedRuntimeBundle)))
    throw new Error("runtime bundle output must be an absolute path which does not exist");

const matrix = (tx = 0, ty = 0) => ({ a: 1, b: 0, c: 0, d: 1, tx, ty });
const textField = id => ({
    characterId: id,
    kind: "input-text",
    initialText: `text-${id}`,
    bounds: { x: 0, y: 0, width: 60, height: 16 },
    textField: {
        align: "left", autoSize: false, border: false, color: { alpha: 1, color: 0xffffff },
        fieldType: "dynamic", fontId: 4, fontSize: 12, html: false, indent: 0,
        initialText: `text-${id}`, leading: 0, leftMargin: 0, multiline: false,
        password: false, rightMargin: 0, selectable: false, useOutlines: false,
        variableName: "", wordWrap: false,
    },
});
const place = (characterId, depth, options = {}) => ({
    op: "place", characterId, depth, move: false, ratio: 0, matrix: matrix(), ...options,
});

function sourceFixture(withRatios = true) {
    const assets = {
        "4": { characterId: 4, kind: "font", font: { family: "Fixture Sans", bold: false, italic: false } },
        "18": textField(18), "19": textField(19),
        "20": { characterId: 20, kind: "sprite", symbolName: "_fixture.RowDefinition", bounds: { x: 0, y: 0, width: 120, height: 18 } },
        "22": textField(22), "23": textField(23), "25": textField(25),
        "27": textField(27), "28": textField(28), "30": textField(30), "31": textField(31),
        "32": { characterId: 32, kind: "sprite", symbolName: "_fixture.AllSaleDefinition", bounds: { x: 0, y: 0, width: 72, height: 28 } },
        "40": { characterId: 40, kind: "sprite", symbolName: "MC_SellFixture", bounds: { x: 0, y: 0, width: 217, height: 479 } },
    };
    const rootOperations = Array.from({ length: 16 }, (_, index) =>
        place(20, index + 1, { name: `MC_ItemCaption_${index}`, matrix: matrix(18, 59 + index * 22) }));
    rootOperations.push(place(32, 17, { name: "MC_AllSale", matrix: matrix(72, 434) }));
    const timelines = new Map([
        [20, {
            schema: "flash-timeline@1", symbolId: 20, symbolName: "_fixture.RowDefinition", frameRate: 24, frameCount: 2,
            frames: [
                { index: 1, operations: [
                    place(18, 1, { name: "TF_ItemCaption" }),
                    place(19, 2, { name: "TF_ItemQuantity", matrix: matrix(64, 0) }),
                ] },
                { index: 2, operations: [] },
            ],
        }],
        [32, {
            schema: "flash-timeline@1", symbolId: 32, symbolName: "_fixture.AllSaleDefinition", frameRate: 24, frameCount: 4,
            frames: [
                { index: 1, label: "up", operations: [
                    { op: "label", name: "up" }, place(22, 1), place(23, 2),
                ] },
                { index: 2, label: "over", operations: [
                    { op: "label", name: "over" }, place(25, 1, { move: true }),
                ] },
                { index: 3, label: "down", operations: [
                    { op: "remove", depth: 2 }, { op: "label", name: "down" },
                    place(27, 1, { move: true }), place(28, 2, { ratio: withRatios ? 2 : 0 }),
                ] },
                { index: 4, label: "disabled", operations: [
                    { op: "remove", depth: 2 }, { op: "label", name: "disabled" },
                    place(30, 1, { move: true }), place(31, 2, { ratio: withRatios ? 3 : 0 }),
                ] },
            ],
        }],
        [40, {
            schema: "flash-timeline@1", symbolId: 40, symbolName: "MC_SellFixture", frameRate: 24, frameCount: 1,
            frames: [{ index: 1, operations: rootOperations }],
        }],
    ]);
    return {
        library: {
            schema: "flash-library@1", assets, frameLabels: [],
            stage: { width: 217, height: 479, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0 } },
        },
        timelines,
    };
}

function writeSource(root, source) {
    fs.mkdirSync(path.join(root, "timelines"), { recursive: true });
    const library = structuredClone(source.library);
    library.timelines = Object.fromEntries([...source.timelines.keys()].map(id => [String(id), `timelines/${id}.timeline.json`]));
    fs.writeFileSync(path.join(root, "library.json"), `${JSON.stringify(library, null, 2)}\n`);
    for (const [id, timeline] of source.timelines)
        fs.writeFileSync(path.join(root, "timelines", `${id}.timeline.json`), `${JSON.stringify(timeline, null, 2)}\n`);
}

function emit(sourceRoot, outputRoot) {
    execFileSync(process.execPath, [
        path.resolve(__dirname, "../../src/extensions/authoredContent/scripts/emitFlashLibrarySymbolBundle.cjs"),
        sourceRoot, outputRoot, "40", "Fixture.Authored.MC_Sell", "mc-sell-fixture", "library-symbol",
    ], { cwd: path.resolve(__dirname, "../.."), stdio: "pipe", env: process.env });
}

function fileAuthority(root) {
    return fs.readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
        .sort()
        .map(relative => ({
            relative,
            sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex"),
        }));
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "laya-repeated-placement-"));
try {
    const ratioSource = path.join(temporaryRoot, "source-ratio");
    const zeroSource = path.join(temporaryRoot, "source-zero");
    writeSource(ratioSource, sourceFixture(true));
    writeSource(zeroSource, sourceFixture(false));
    const ratioA = requestedRuntimeBundle ?? path.join(temporaryRoot, "ratio-a");
    const ratioB = path.join(temporaryRoot, "ratio-b");
    const zero = path.join(temporaryRoot, "zero");
    emit(ratioSource, ratioA);
    emit(ratioSource, ratioB);
    emit(zeroSource, zero);
    assert.deepEqual(fileAuthority(ratioA), fileAuthority(ratioB), "repeated-placement emission was not deterministic");

    const hierarchyPath = path.join(ratioA, "mc-sell-fixture.lh");
    const hierarchy = JSON.parse(fs.readFileSync(hierarchyPath, "utf8"));
    assert.deepEqual(hierarchy._$authoredContent.inertPlacementRatios, [
        { timelineSymbolId: 32, frameIndex: 3, operationIndex: 3, depth: 2, characterId: 28, characterKind: "input-text", ratio: 2 },
        { timelineSymbolId: 32, frameIndex: 4, operationIndex: 3, depth: 2, characterId: 31, characterKind: "input-text", ratio: 3 },
    ], "exact inert ratio evidence drifted");
    const rows = hierarchy._$child.filter(child => /^MC_ItemCaption_\d+$/.test(child.name));
    assert.equal(rows.length, 16, "emitted hierarchy lost repeated row placements");
    assert.equal(new Set(rows.map(row => row.name)).size, 16, "repeated rows did not retain unique authored names");
    const metadataRows = hierarchy._$authoredContent.nodes.filter(node => node.linkageClass === "_fixture.RowDefinition");
    assert.equal(metadataRows.length, 16, "metadata collapsed repeated definition placements");
    assert.equal(new Set(metadataRows.map(node => node.instanceId)).size, 16, "metadata placement identities collide");

    const zeroHierarchy = JSON.parse(fs.readFileSync(path.join(zero, "mc-sell-fixture.lh"), "utf8"));
    delete hierarchy._$authoredContent.inertPlacementRatios;
    delete zeroHierarchy._$authoredContent.inertPlacementRatios;
    assert.deepEqual(hierarchy, zeroHierarchy, "inert ratio metadata changed native hierarchy semantics");
    const ratioTimelineAuthority = fileAuthority(ratioA).filter(file => file.relative.endsWith(".mc"));
    const zeroTimelineAuthority = fileAuthority(zero).filter(file => file.relative.endsWith(".mc"));
    assert.deepEqual(ratioTimelineAuthority, zeroTimelineAuthority, "inert ratios changed native timeline bytes");
}
finally {
    assert.ok(temporaryRoot.startsWith(path.join(os.tmpdir(), "laya-repeated-placement-")));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("authored repeated placement emitter: PASS\n");
