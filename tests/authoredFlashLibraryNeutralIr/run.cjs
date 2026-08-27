"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "../..");
const emitter = path.join(repositoryRoot, "src/extensions/authoredContent/scripts/emitFlashLibrarySymbolBundle.cjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "laya-neutral-ir-"));

try {
    const evidence = path.join(temporary, "evidence");
    const timelines = path.join(evidence, "timelines");
    fs.mkdirSync(timelines, { recursive: true });
    fs.writeFileSync(path.join(evidence, "library.json"), JSON.stringify({
        schema: "flash-library@1",
        assets: {
            "8": { characterId: 8, kind: "sprite", symbolName: "Root", bounds: { x: 0, y: 0, width: 320, height: 200 } }
        },
        frameLabels: [],
        stage: { width: 320, height: 200, frameRate: 24, frameCount: 1, backgroundColor: { alpha: 1, color: 0x102030 } },
        timelines: { "8": "timelines/8.json" }
    }));
    fs.writeFileSync(path.join(timelines, "8.json"), JSON.stringify({
        schema: "flash-timeline@1",
        symbolId: 8,
        symbolName: "Root",
        frameRate: 24,
        frameCount: 1,
        frames: [{ index: 1, operations: [] }]
    }));

    const output = path.join(temporary, "neutral", "root.neutral.json");
    const common = [evidence, "-", "8", "Fixture.Root", "fixture-root", "library-symbol", "--neutral-output", output, "--neutral-only"];
    const written = invoke(common);
    assert.equal(written.status, 0, written.stderr);
    const receipt = JSON.parse(written.stdout);
    assert.equal(receipt.status, "written");
    assert.equal(receipt.schema, "neutral-authored-content-emission@1");
    const bytes = fs.readFileSync(output);
    assert.equal(receipt.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(receipt.byteLength, bytes.byteLength);
    const content = JSON.parse(bytes);
    assert.equal(content.schema, "neutral-authored-content@1");
    assert.equal(content.root.runtimeLinkage, "Fixture.Root");
    assert.equal(content.documentId, "flash-library-symbol-8");
    assert.deepEqual(content.stage, {
        backgroundColor: { alpha: 0, color: 0 },
        frameCount: 1,
        frameRate: 24,
        height: 200,
        width: 320,
    });
    assert.equal(bytes.at(-1), 10, "neutral IR is not LF-terminated");
    assert.equal(bytes.toString("utf8"), `${JSON.stringify(canonical(content))}\n`);
    assert.deepEqual(fs.readdirSync(path.dirname(output)), [path.basename(output)], "atomic temporary file leaked");

    const unchanged = invoke(common);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).status, "unchanged");
    const checked = invoke([...common, "--check"]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).status, "unchanged");

    fs.writeFileSync(output, JSON.stringify(content, null, 2));
    const drift = invoke([...common, "--check"]);
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /AUTHORED_CONTENT_NEUTRAL_OUTPUT_DRIFT/);
    assert.notEqual(fs.readFileSync(output, "utf8"), bytes.toString("utf8"), "check rewrote drift");
    const repaired = invoke(common);
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.equal(fs.readFileSync(output, "utf8"), bytes.toString("utf8"));

    const invalid = invoke([...common, "--invented"]);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /^usage:/);

    const textMapEvidence = path.join(temporary, "text-map-evidence");
    fs.cpSync(evidence, textMapEvidence, { recursive: true });
    const textMapLibrary = JSON.parse(fs.readFileSync(path.join(textMapEvidence, "library.json")));
    textMapLibrary.assets[8].scalingGrid = {
        characterId: 8, sourceTag: "DefineScalingGridTag", units: "pixels", valid: true,
        rect: { x: 10, y: 10, width: 100, height: 80 }, sizeGrid: [10, 210, 110, 10, 0],
    };
    textMapLibrary.assets[42] = {
        characterId: 42,
        kind: "shape",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        shape: { fillStyles: [], lineStyles: [], segments: [], usesFillWindingRule: false }
    };
    textMapLibrary.assets[43] = {
        characterId: 43,
        kind: "text",
        initialText: "  Localized text\n",
        bounds: { x: 1, y: 2, width: 100, height: 20 },
        staticText: {
            exactGlyphs: true,
            issues: [],
            matrix: { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 },
            runs: []
        }
    };
    fs.writeFileSync(path.join(textMapEvidence, "library.json"), JSON.stringify(textMapLibrary));
    const textMapTimeline = JSON.parse(fs.readFileSync(path.join(textMapEvidence, "timelines/8.json")));
    textMapTimeline.frames[0].operations.push({
        op: "place", characterId: 42, depth: 1, move: false, ratio: 0,
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    });
    textMapTimeline.frames[0].operations.push({
        op: "place", characterId: 43, depth: 2, move: false, ratio: 0,
        name: "title", matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    });
    fs.writeFileSync(path.join(textMapEvidence, "timelines/8.json"), JSON.stringify(textMapTimeline));
    const textMapOutput = path.join(temporary, "neutral", "text-map.neutral.json");
    const textMapCommon = [textMapEvidence, "-", "8", "Fixture.Root", "fixture-root", "library-symbol", "--neutral-output", textMapOutput, "--neutral-only"];
    const strictShape = invoke(textMapCommon);
    assert.equal(strictShape.status, 1);
    assert.match(strictShape.stderr, /FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED/);
    const textMapWritten = invoke([...textMapCommon, "--text-map-only"]);
    assert.equal(textMapWritten.status, 0, textMapWritten.stderr);
    const textMapContent = JSON.parse(fs.readFileSync(textMapOutput));
    assert.equal(textMapContent.root.children[0].kind, "container");
    assert.equal(textMapContent.root.children[1].name, "title");
    assert.equal(textMapContent.root.children[1].textField.initialText, "  Localized text\n");
    assert.equal(textMapContent.root.scale9Grid, undefined);
    assert.deepEqual(textMapContent.resources, []);

    process.stdout.write("authored Flash-library neutral IR emitter: 26/26 passed\n");
}
finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}

function invoke(arguments_) {
    return spawnSync(process.execPath, [emitter, ...arguments_], {
        cwd: repositoryRoot,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, LAYAAIR_IDE_RESOURCES: path.join(temporary, "missing-ide") }
    });
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
