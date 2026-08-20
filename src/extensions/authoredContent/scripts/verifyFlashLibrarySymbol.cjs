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
const content = new FlashLibrarySymbolAdapter().parse({
    library,
    timelines,
    entrySymbolId,
    runtimeLinkage,
    resources,
});
process.stdout.write(`${JSON.stringify(content, null, 2)}\n`);

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
