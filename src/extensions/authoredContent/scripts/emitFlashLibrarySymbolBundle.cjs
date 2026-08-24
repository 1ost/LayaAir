"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const GAME_ENTRY_MODULE = 76383;
const ENGINE_EXTERNAL_MODULE = 618;
const HIERARCHY_WRITER_MODULE = 24294;
const TYPE_REGISTRY_MODULE = 33151;
const ENGINE_TYPE_BINDINGS_MODULE = 93471;
const ENGINE_TYPES_MODULE = 44898;

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

async function main() {
    const sourceRoot = path.resolve(process.argv[2] || "");
    const outputRoot = path.resolve(process.argv[3] || "");
    const entrySymbolId = Number(process.argv[4]);
    const runtimeLinkage = process.argv[5];
    const assetBaseName = process.argv[6] || "bootstrap-loading";
    if (!path.isAbsolute(sourceRoot) || !path.isAbsolute(outputRoot)
        || !Number.isSafeInteger(entrySymbolId) || entrySymbolId < 1 || !runtimeLinkage
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetBaseName)) {
        process.stderr.write("usage: node emitFlashLibrarySymbolBundle.cjs <absolute-source-root> <absolute-output-root> <symbol-id> <runtime-linkage> [asset-base-name]\n");
        process.exitCode = 2;
        return;
    }
    if (fs.existsSync(outputRoot))
        throw new Error(`AUTHORED_CONTENT_OUTPUT_EXISTS: ${outputRoot}`);

    const library = readJson(path.join(sourceRoot, "library.json"));
    const timelines = new Map(Object.entries(library.timelines).map(([id, relative]) => [
        Number(id),
        readJson(resolveInside(sourceRoot, relative)),
    ]));
    const authorities = new Map();
    for (const asset of Object.values(library.assets)) {
        if ((asset.kind !== "shape" && asset.kind !== "image") || typeof asset.path !== "string") continue;
        const bytes = fs.readFileSync(resolveInside(sourceRoot, asset.path));
        authorities.set(asset.path, {
            sourcePath: asset.path,
            mediaType: asset.path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
            byteLength: bytes.byteLength,
            sha256: hash(bytes),
        });
    }
    const { FlashLibrarySymbolAdapter } = require("../offlineAdapters/FlashLibrarySymbolAdapter.ts");
    const content = new FlashLibrarySymbolAdapter().parse({
        library,
        timelines,
        entrySymbolId,
        runtimeLinkage,
        resources: authorities,
    });

    const HierarchyWriter = loadIdeHierarchyWriter();
    const { NativeLayaEmitter } = require("../emit/NativeLayaEmitter.ts");
    const { NativeAnimationClip2DWriter } = require("../emit/NativeAnimationClip2DWriter.ts");
    const { prepareNativeLayaAuthoredContentBundle } = require("../emit/NativeLayaHierarchyWriter.ts");
    const resourcePayloads = new Map(content.resources.map(resource => [
        resource.id,
        new Uint8Array(fs.readFileSync(resolveInside(sourceRoot, resource.sourcePath))),
    ]));
    const nestedClips = NativeLayaEmitter.createNestedTimelines(content);
    const nestedDefinitions = [...nestedClips].map(([semanticPath, clip], index) => ({
        semanticPath,
        clip,
        timelinePath: `timelines/nested-${index + 1}.mc`,
    }));
    const { createNativeBundleAssetBindings } = require("../emit/NativeBundleAssetIdentity.ts");
    const assetBindings = createNativeBundleAssetBindings(
        assetBaseName,
        `${assetBaseName}.mc`,
        content.resources.map(resource => ({ id: resource.id, outputPath: resource.outputPath })),
        nestedDefinitions.map(value => ({ semanticPath: value.semanticPath, outputPath: value.timelinePath })),
    );
    const resourceAssetIds = assetBindings.resourceAssetIds;
    const nestedAssets = nestedDefinitions.map(value => ({
        ...value,
        timelineAssetId: assetBindings.nestedTimelineAssetIds.get(value.semanticPath),
    }));
    const nestedBindings = new Map(nestedAssets.map(value => [value.semanticPath, {
        assetId: value.timelineAssetId,
        clip: value.clip,
    }]));
    const rootClip = NativeLayaEmitter.createTimeline(content);
    const root = NativeLayaEmitter.createPrefabRoot(
        content,
        assetBindings.timelineAssetId,
        rootClip,
        resourceAssetIds,
        nestedBindings,
    );
    try {
        const hierarchy = HierarchyWriter.write(root, { creatingPrefab: true });
        const bundle = await prepareNativeLayaAuthoredContentBundle({
            content,
            hierarchy,
            prefabPath: `${assetBaseName}.lh`,
            timelinePath: `${assetBaseName}.mc`,
            timelineAssetId: assetBindings.timelineAssetId,
            timelineBytes: new Uint8Array(NativeAnimationClip2DWriter.write(rootClip)),
            nestedTimelines: nestedAssets.map(value => ({
                semanticPath: value.semanticPath,
                timelinePath: value.timelinePath,
                timelineAssetId: value.timelineAssetId,
                timelineBytes: new Uint8Array(NativeAnimationClip2DWriter.write(value.clip)),
            })),
            resourceAssetIds,
            resourcePayloads,
            sha256: hash,
        });
        fs.mkdirSync(outputRoot);
        for (const file of bundle.files) {
            const target = path.join(outputRoot, ...file.path.split("/"));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, file.bytes);
        }
        process.stdout.write(`${JSON.stringify({
            schema: bundle.schema,
            files: bundle.files.map(file => ({ path: file.path, kind: file.kind, byteLength: file.bytes.byteLength })),
        }, null, 2)}\n`);
    }
    finally {
        root.destroy();
        rootClip.destroy();
        nestedClips.forEach(clip => clip.destroy());
    }
}

function loadIdeHierarchyWriter() {
    const resources = process.env.LAYAAIR_IDE_RESOURCES
        ? path.resolve(process.env.LAYAAIR_IDE_RESOURCES)
        : path.join(process.env.LOCALAPPDATA, "Programs", "LayaAirIDE", "resources");
    const archive = readAsar(path.join(resources, "app.asar"));
    const manifest = JSON.parse(archive.read("package.json"));
    if (manifest.version !== "3.4.0")
        throw new Error(`AUTHORED_CONTENT_IDE_VERSION_UNSUPPORTED: ${manifest.version}`);
    globalThis.window = globalThis;
    globalThis.document = {};
    for (const libraryPath of ["laya.core.js", "laya.d3.js", "laya.ui.js", "laya.no-render.js"])
        require(path.join(resources, "engine", "libs", libraryPath));
    globalThis.Laya.Laya._beforeInitCallbacks.forEach(callback => callback({}));
    globalThis.Laya.ILaya.stage = {
        _graphicUpdateList: new Set(),
        _componentDriver: { _toDestroys: new Set() },
    };
    globalThis.Laya.ILaya.systemTimer = { callLater() {}, runCallLater() {} };
    globalThis.Laya.ILaya.timer = { callLater() {}, runCallLater() {} };
    globalThis.Laya.ILaya.loader = new globalThis.Laya.Loader();
    globalThis.Laya.ControllerRef ||= class ControllerRef {};
    const originalLoad = Module._load;
    Module._load = function loadWithoutElectron(request) {
        if (request === "electron") return {};
        return originalLoad.apply(this, arguments);
    };
    globalThis.require = require;
    try {
        let gameSource = archive.read("game.js");
        const entry = `var __webpack_exports__=__webpack_require__(${GAME_ENTRY_MODULE})`;
        if (!gameSource.includes(entry))
            throw new Error("AUTHORED_CONTENT_IDE_BUNDLE_ENTRY_MISSING");
        gameSource = gameSource.replace(entry, "globalThis.__authoredContentIdeRequire=__webpack_require__");
        vm.runInThisContext(gameSource, { filename: "LayaAirIDE-3.4.0-game.js" });
        const ideRequire = globalThis.__authoredContentIdeRequire;
        if (ideRequire(ENGINE_EXTERNAL_MODULE) !== globalThis.Laya)
            throw new Error("AUTHORED_CONTENT_IDE_ENGINE_BINDING_MISMATCH");
        const typeRegistry = ideRequire(TYPE_REGISTRY_MODULE).typeRegistry;
        typeRegistry.addTypes(ideRequire(ENGINE_TYPES_MODULE).allTypes);
        ideRequire(ENGINE_TYPE_BINDINGS_MODULE).bindEngineTypes();
        return ideRequire(HIERARCHY_WRITER_MODULE).HierarchyWriter;
    }
    finally {
        Module._load = originalLoad;
    }
}

function readAsar(filePath) {
    const bytes = fs.readFileSync(filePath);
    const baseOffset = 8 + bytes.readUInt32LE(4);
    const headerLength = bytes.readUInt32LE(12);
    const header = JSON.parse(bytes.subarray(16, 16 + headerLength).toString("utf8"));
    return {
        read(relativePath) {
            let entry = header;
            for (const segment of relativePath.split("/")) entry = entry.files?.[segment];
            if (!entry || entry.files)
                throw new Error(`AUTHORED_CONTENT_IDE_ARCHIVE_ENTRY_MISSING: ${relativePath}`);
            const start = baseOffset + Number(entry.offset);
            return bytes.subarray(start, start + entry.size).toString("utf8");
        },
    };
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveInside(root, relative) {
    if (typeof relative !== "string" || path.isAbsolute(relative))
        throw new Error(`FLASH_LIBRARY_RESOURCE_PATH_INVALID: ${String(relative)}`);
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(`${root}${path.sep}`))
        throw new Error(`FLASH_LIBRARY_RESOURCE_ESCAPES_ROOT: ${relative}`);
    return resolved;
}

function hash(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
});
