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
    const options = parseOptions(process.argv.slice(2));
    if (!options) return;
    const {
        sourceRoot, outputRoot, entrySymbolId, runtimeLinkage, assetBaseName, projection,
        neutralOutput, neutralOnly, textMapOnly, check,
    } = options;
    if (!path.isAbsolute(sourceRoot) || (!neutralOnly && !path.isAbsolute(outputRoot))
        || !Number.isSafeInteger(entrySymbolId) || entrySymbolId < 1 || !runtimeLinkage
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetBaseName)
        || !["document", "library-symbol"].includes(projection)) {
        usage();
        return;
    }
    if (!neutralOnly && fs.existsSync(outputRoot))
        throw new Error(`AUTHORED_CONTENT_OUTPUT_EXISTS: ${outputRoot}`);

    const library = readJson(path.join(sourceRoot, "library.json"));
    const timelines = new Map(Object.entries(library.timelines).map(([id, relative]) => [
        Number(id),
        readJson(resolveInside(sourceRoot, relative)),
    ]));
    const authorities = new Map();
    for (const asset of Object.values(library.assets)) {
        if ((asset.kind !== "shape" && asset.kind !== "image" && asset.kind !== "font") || typeof asset.path !== "string") continue;
        const bytes = fs.readFileSync(resolveInside(sourceRoot, asset.path));
        const lowerPath = asset.path.toLowerCase();
        if (asset.kind === "font" && (!lowerPath.endsWith(".ttf") || !isTrueType(bytes)))
            throw new Error(`FLASH_LIBRARY_FONT_RESOURCE_FORMAT_UNSUPPORTED: ${asset.path}`);
        authorities.set(asset.path, {
            sourcePath: asset.path,
            mediaType: asset.kind === "font" ? "font/ttf" : lowerPath.endsWith(".png") ? "image/png" : "image/jpeg",
            byteLength: bytes.byteLength,
            sha256: hash(bytes),
        });
    }
    const rasterAuthorities = readRasterAuthorities(sourceRoot);
    const { FlashLibrarySymbolAdapter } = require("../offlineAdapters/FlashLibrarySymbolAdapter.ts");
    const content = new FlashLibrarySymbolAdapter().parse({
        library,
        timelines,
        entrySymbolId,
        runtimeLinkage,
        resources: authorities,
        projection,
        textMapOnly,
        rasterizedShapes: rasterAuthorities.shapes,
        rasterizedSprites: rasterAuthorities.sprites,
    });
    const neutralBytes = Buffer.from(canonicalJson(content), "utf8");
    if (neutralOnly) {
        const status = publishNeutralOutput(neutralOutput, neutralBytes, check);
        process.stdout.write(`${JSON.stringify({
            schema: "neutral-authored-content-emission@1",
            status,
            output: neutralOutput,
            sha256: hash(neutralBytes),
            byteLength: neutralBytes.byteLength,
        }, null, 2)}\n`);
        return;
    }

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
        const neutralStatus = neutralOutput === undefined
            ? undefined
            : publishNeutralOutput(neutralOutput, neutralBytes, false);
        process.stdout.write(`${JSON.stringify({
            schema: bundle.schema,
            files: bundle.files.map(file => ({ path: file.path, kind: file.kind, byteLength: file.bytes.byteLength })),
            ...(neutralOutput === undefined ? {} : {
                neutralIr: {
                    status: neutralStatus,
                    output: neutralOutput,
                    sha256: hash(neutralBytes),
                    byteLength: neutralBytes.byteLength,
                },
            }),
        }, null, 2)}\n`);
    }
    finally {
        root.destroy();
        rootClip.destroy();
        nestedClips.forEach(clip => clip.destroy());
    }
}

function parseOptions(arguments_) {
    const flagIndex = arguments_.findIndex(value => value.startsWith("--"));
    const positional = flagIndex < 0 ? arguments_ : arguments_.slice(0, flagIndex);
    const flags = flagIndex < 0 ? [] : arguments_.slice(flagIndex);
    if (positional.length < 4 || positional.length > 6) {
        usage();
        return null;
    }
    let neutralOutput;
    let neutralOnly = false;
    let textMapOnly = false;
    let check = false;
    for (let index = 0; index < flags.length; index++) {
        const flag = flags[index];
        if (flag === "--neutral-output") {
            if (neutralOutput !== undefined || index + 1 >= flags.length || flags[index + 1].startsWith("--")) {
                usage();
                return null;
            }
            const value = flags[++index];
            if (!path.isAbsolute(value) || value.includes("\0")) {
                usage();
                return null;
            }
            neutralOutput = path.normalize(value);
        }
        else if (flag === "--neutral-only") {
            if (neutralOnly) { usage(); return null; }
            neutralOnly = true;
        }
        else if (flag === "--text-map-only") {
            if (textMapOnly) { usage(); return null; }
            textMapOnly = true;
        }
        else if (flag === "--check") {
            if (check) { usage(); return null; }
            check = true;
        }
        else { usage(); return null; }
    }
    if ((neutralOnly || check) && neutralOutput === undefined) { usage(); return null; }
    if (check) neutralOnly = true;
    if (textMapOnly && !neutralOnly) { usage(); return null; }
    const rawSourceRoot = positional[0];
    const rawOutputRoot = positional[1];
    if (!path.isAbsolute(rawSourceRoot) || (!neutralOnly && !path.isAbsolute(rawOutputRoot))) {
        usage();
        return null;
    }
    return {
        sourceRoot: path.normalize(rawSourceRoot),
        outputRoot: neutralOnly ? rawOutputRoot : path.normalize(rawOutputRoot),
        entrySymbolId: Number(positional[2]),
        runtimeLinkage: positional[3],
        assetBaseName: positional[4] || "bootstrap-loading",
        projection: positional[5] || "document",
        neutralOutput,
        neutralOnly,
        textMapOnly,
        check,
    };
}

function usage() {
    process.stderr.write(
        "usage: node emitFlashLibrarySymbolBundle.cjs <absolute-source-root> <absolute-output-root|-> <symbol-id> <runtime-linkage> [asset-base-name] [document|library-symbol] [--neutral-output <absolute-file>] [--neutral-only] [--text-map-only] [--check]\n"
    );
    process.exitCode = 2;
}

function publishNeutralOutput(output, bytes, check) {
    const existing = readRegularOutput(output);
    if (existing?.equals(bytes)) return "unchanged";
    if (check)
        throw new Error(existing === undefined
            ? `AUTHORED_CONTENT_NEUTRAL_OUTPUT_MISSING: ${output}`
            : `AUTHORED_CONTENT_NEUTRAL_OUTPUT_DRIFT: ${output}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`);
    const handle = fs.openSync(temporary, "wx");
    try {
        fs.writeFileSync(handle, bytes);
        fs.fsyncSync(handle);
    }
    finally { fs.closeSync(handle); }
    try { fs.renameSync(temporary, output); }
    catch (error) {
        try { fs.unlinkSync(temporary); } catch {}
        throw error;
    }
    return "written";
}

function readRegularOutput(output) {
    try {
        const info = fs.lstatSync(output);
        if (info.isSymbolicLink() || !info.isFile())
            throw new Error(`AUTHORED_CONTENT_NEUTRAL_OUTPUT_TYPE_INVALID: ${output}`);
        return fs.readFileSync(output);
    }
    catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
    }
}

function canonicalJson(value) {
    return `${JSON.stringify(canonicalValue(value))}\n`;
}

function canonicalValue(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("AUTHORED_CONTENT_NEUTRAL_CANONICAL_NUMBER_INVALID");
        return value;
    }
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === "object") {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            // Normalized IR retains optional interface slots as undefined in
            // memory. JSON has no undefined value, so canonical persistence
            // omits those optional object fields exactly as JSON.stringify.
            if (value[key] === undefined) continue;
            result[key] = canonicalValue(value[key]);
        }
        return result;
    }
    throw new Error(`AUTHORED_CONTENT_NEUTRAL_CANONICAL_TYPE_INVALID: ${typeof value}`);
}

function readRasterAuthorities(sourceRoot) {
    const manifestPath = path.join(sourceRoot, "raster-authority.json");
    if (!fs.existsSync(manifestPath)) return { shapes: new Map(), sprites: new Map() };
    const manifest = exactObject(readJson(manifestPath), ["schema", "shapes", "sprites"], "raster authority");
    if (manifest.schema !== "flash-library-raster-authority@1")
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_SCHEMA_UNSUPPORTED: ${String(manifest.schema)}`);
    const shapeRecords = exactObject(manifest.shapes, Object.keys(objectRecord(manifest.shapes, "raster authority shapes")), "raster authority shapes");
    const spriteRecords = exactObject(manifest.sprites, Object.keys(objectRecord(manifest.sprites, "raster authority sprites")), "raster authority sprites");
    const shapes = new Map();
    for (const [idText, value] of Object.entries(shapeRecords)) {
        const id = characterId(idText, "rasterized shape");
        const record = exactObject(value, ["path"], `rasterized shape ${id}`);
        const authority = resourceAuthority(sourceRoot, record.path);
        if (authority.mediaType !== "image/png")
            throw new Error(`FLASH_LIBRARY_RASTERIZED_SHAPE_PNG_REQUIRED: ${id}`);
        const dimensions = pngDimensions(fs.readFileSync(resolveInside(sourceRoot, record.path)), record.path);
        shapes.set(id, {
            ...authority,
            pixelWidth: dimensions.width,
            pixelHeight: dimensions.height,
        });
    }
    const sprites = new Map();
    for (const [idText, value] of Object.entries(spriteRecords)) {
        const id = characterId(idText, "rasterized sprite");
        if (!Array.isArray(value) || value.length === 0)
            throw new Error(`FLASH_LIBRARY_RASTERIZED_SPRITE_FRAMES_INVALID: ${id}`);
        sprites.set(id, value.map((frameValue, index) => {
            const frame = exactObject(frameValue, ["height", "path", "width", "x", "y"], `rasterized sprite ${id} frame ${index + 1}`);
            const authority = resourceAuthority(sourceRoot, frame.path);
            const bytes = fs.readFileSync(resolveInside(sourceRoot, frame.path));
            const dimensions = pngDimensions(bytes, frame.path);
            const width = positiveNumber(frame.width, `${id} frame ${index + 1} width`);
            const height = positiveNumber(frame.height, `${id} frame ${index + 1} height`);
            if (dimensions.width !== width || dimensions.height !== height)
                throw new Error(`FLASH_LIBRARY_RASTERIZED_SPRITE_DIMENSION_MISMATCH: ${id} frame ${index + 1}`);
            return {
                ...authority,
                x: finiteNumber(frame.x, `${id} frame ${index + 1} x`),
                y: finiteNumber(frame.y, `${id} frame ${index + 1} y`),
                width,
                height,
            };
        }));
    }
    return { shapes, sprites };
}

function resourceAuthority(sourceRoot, relative) {
    const sourcePath = relativePath(relative, "raster authority path");
    const resolved = resolveInside(sourceRoot, sourcePath);
    const info = fs.lstatSync(resolved);
    if (!info.isFile() || info.isSymbolicLink())
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_FILE_INVALID: ${sourcePath}`);
    const bytes = fs.readFileSync(resolved);
    const lower = sourcePath.toLowerCase();
    const mediaType = lower.endsWith(".png") ? "image/png"
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : null;
    if (!mediaType)
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_MEDIA_UNSUPPORTED: ${sourcePath}`);
    return { sourcePath, mediaType, byteLength: bytes.byteLength, sha256: hash(bytes) };
}

function pngDimensions(bytes, label) {
    if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" || bytes.toString("ascii", 12, 16) !== "IHDR")
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_PNG_INVALID: ${label}`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function objectRecord(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_OBJECT_REQUIRED: ${label}`);
    return value;
}

function exactObject(value, keys, label) {
    const record = objectRecord(value, label);
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_FIELDS_UNSUPPORTED: ${label}`);
    return record;
}

function characterId(value, label) {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 1 || String(result) !== value)
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_ID_INVALID: ${label} ${value}`);
    return result;
}

function finiteNumber(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_NUMBER_INVALID: ${label}`);
    return value;
}

function positiveNumber(value, label) {
    const result = finiteNumber(value, label);
    if (result <= 0)
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_NUMBER_INVALID: ${label}`);
    return result;
}

function relativePath(value, label) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\\") || path.isAbsolute(value)
        || value.split("/").some(part => !part || part === "." || part === ".."))
        throw new Error(`FLASH_LIBRARY_RASTER_AUTHORITY_PATH_INVALID: ${label}`);
    return value;
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

function isTrueType(bytes) {
    return bytes.length >= 12 && bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;
}

main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
});
