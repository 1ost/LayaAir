"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
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

const sourceRoot = path.resolve(process.argv[2] || "");
const entrySymbolId = Number(process.argv[3]);
const runtimeLinkage = process.argv[4];
const adversarial = process.argv[5] === "--adversarial";
if (!path.isAbsolute(sourceRoot) || !Number.isSafeInteger(entrySymbolId) || entrySymbolId < 1 || !runtimeLinkage) {
    process.stderr.write("usage: node verifyFlashLibrarySymbol.cjs <absolute-source-root> <symbol-id> <runtime-linkage>\n");
    process.exit(2);
}

const library = readJson(path.join(sourceRoot, "library.json"));
const timelines = new Map(Object.entries(library.timelines).map(([id, relative]) => [
    Number(id),
    readJson(resolveInside(sourceRoot, relative)),
]));
const resources = new Map();
for (const asset of Object.values(library.assets)) {
    if (asset.kind !== "shape") continue;
    const absolute = resolveInside(sourceRoot, asset.path);
    const bytes = fs.readFileSync(absolute);
    resources.set(asset.path, {
        sourcePath: asset.path,
        mediaType: asset.path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
        byteLength: bytes.byteLength,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
}

const { FlashLibrarySymbolAdapter } = require("../offlineAdapters/FlashLibrarySymbolAdapter.ts");
const adapter = new FlashLibrarySymbolAdapter();
const request = {
    library,
    timelines,
    entrySymbolId,
    runtimeLinkage,
    resources,
};
const content = adapter.parse(request);
if (adversarial) {
    const rejected = verifyFailClosedMutations(adapter, request);
    process.stdout.write(`${JSON.stringify({
        phase: "adapter-parse",
        baselineDocumentId: content.documentId,
        rejected,
    }, null, 2)}\n`);
}
else {
    process.stdout.write(`${JSON.stringify(content, null, 2)}\n`);
}

function verifyFailClosedMutations(adapter, baseline) {
    const cases = [
        ["text html", request => firstTextField(request).html = true, /FLASH_LIBRARY_TEXT_HTML_UNSUPPORTED/],
        ["text auto-size true", request => firstTextField(request).autoSize = true, /FLASH_LIBRARY_TEXT_AUTO_SIZE_UNSUPPORTED/],
        ["text auto-size non-none", request => firstTextField(request).autoSize = "left", /FLASH_LIBRARY_TEXT_AUTO_SIZE_UNSUPPORTED/],
        ["text border", request => firstTextField(request).border = true, /FLASH_LIBRARY_TEXT_BORDER_UNSUPPORTED/],
        ["text unknown field", request => firstTextField(request).outline = true, /FLASH_LIBRARY_TEXT_FIELD_UNSUPPORTED/],
        ["text color alpha", request => firstTextField(request).color.alpha = 0.5, /FLASH_LIBRARY_TEXT_COLOR_ALPHA_UNSUPPORTED/],
        ["text variable binding", request => firstTextField(request).variableName = "loading", /FLASH_LIBRARY_TEXT_VARIABLE_UNSUPPORTED/],
        ["text authority mismatch", request => firstTextAsset(request).initialText = "drift", /FLASH_LIBRARY_TEXT_INITIAL_VALUE_MISMATCH/],
        ["placement filters", request => firstStaticPlacement(request).filters = [], /FLASH_LIBRARY_PLACE_FIELD_UNSUPPORTED/],
        ["placement blend mode", request => firstStaticPlacement(request).blendMode = "multiply", /FLASH_LIBRARY_PLACE_FIELD_UNSUPPORTED/],
        ["placement matrix field", request => firstStaticPlacement(request).matrix.perspective = 1, /FLASH_LIBRARY_MATRIX_FIELD_UNSUPPORTED/],
        ["static depth move", request => firstStaticPlacement(request).move = true, /FLASH_LIBRARY_STATIC_MOVE_UNSUPPORTED/],
        ["replacement matrix override", request => firstReplacement(request).matrix = unitMatrix(1, 0), /FLASH_LIBRARY_REPLACEMENT_MATRIX_UNSUPPORTED/],
        ["replacement instance name", request => firstReplacement(request).name = "changed", /FLASH_LIBRARY_REPLACEMENT_NAME_UNSUPPORTED/],
        ["frame executable field", request => firstReachableFrame(request).actions = [], /FLASH_LIBRARY_FRAME_FIELD_UNSUPPORTED/],
    ];
    const rejected = [];
    for (const [label, mutate, expected] of cases) {
        const candidate = cloneRequest(baseline);
        mutate(candidate);
        let error;
        try {
            adapter.parse(candidate);
        }
        catch (value) {
            error = value;
        }
        if (!(error instanceof Error) || !expected.test(error.message))
            throw new Error(`FLASH_LIBRARY_ADVERSARIAL_CASE_ACCEPTED: ${label}: ${error?.stack || error || "no rejection"}`);
        rejected.push(label);
    }
    return rejected;
}

function cloneRequest(request) {
    return {
        ...request,
        library: clone(request.library),
        timelines: new Map([...request.timelines].map(([id, value]) => [id, clone(value)])),
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function firstTextAsset(request) {
    const asset = Object.values(request.library.assets).find(value => value.kind === "input-text");
    if (!asset) throw new Error("FLASH_LIBRARY_ADVERSARIAL_TEXT_MISSING");
    return asset;
}

function firstTextField(request) {
    return firstTextAsset(request).textField;
}

function firstStaticPlacement(request) {
    return request.timelines.get(request.entrySymbolId).frames[0].operations[0];
}

function firstReplacement(request) {
    for (const timeline of request.timelines.values()) {
        for (const frame of timeline.frames) {
            const operation = frame.operations.find(value => value.move === true);
            if (operation) return operation;
        }
    }
    throw new Error("FLASH_LIBRARY_ADVERSARIAL_REPLACEMENT_MISSING");
}

function firstReachableFrame(request) {
    return request.timelines.get(request.entrySymbolId).frames[0];
}

function unitMatrix(tx, ty) {
    return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveInside(root, relative) {
    if (typeof relative !== "string" || path.isAbsolute(relative))
        throw new Error(`FLASH_LIBRARY_RESOURCE_PATH_INVALID: ${String(relative)}`);
    const resolved = path.resolve(root, relative);
    const prefix = `${root}${path.sep}`;
    if (!resolved.startsWith(prefix))
        throw new Error(`FLASH_LIBRARY_RESOURCE_ESCAPES_ROOT: ${relative}`);
    return resolved;
}
