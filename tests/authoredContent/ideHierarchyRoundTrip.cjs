"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const vm = require("node:vm");

const GAME_ENTRY_MODULE = 76383;
const ENGINE_EXTERNAL_MODULE = 618;
const HIERARCHY_PARSER_MODULE = 21384;
const HIERARCHY_WRITER_MODULE = 24294;
const TYPE_REGISTRY_MODULE = 33151;
const ENGINE_TYPE_BINDINGS_MODULE = 93471;
const ENGINE_TYPES_MODULE = 44898;
const SERIALIZE_UTIL_MODULE = 78276;

exports.runIdeHierarchyRoundTrip = function runIdeHierarchyRoundTrip() {
    const ideResources = resolveIdeResources();
    const archivePath = path.join(ideResources, "app.asar");
    const corePath = path.join(ideResources, "engine", "libs", "laya.core.js");
    const archive = readAsar(archivePath);
    const manifest = JSON.parse(archive.read("package.json"));
    assert(manifest.version === "3.4.0", `AUTHORED_CONTENT_IDE_VERSION_UNSUPPORTED: ${manifest.version}`);

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousLaya = globalThis.Laya;
    const previousRequire = globalThis.require;
    const originalLoad = Module._load;
    try {
        globalThis.window = globalThis;
        globalThis.document = {};
        delete require.cache[require.resolve(corePath)];
        require(corePath);

        // The editor serializer references this 3D class before it examines a 2D/Node value.
        // The no-render Node-only integration gate does not load the 3D engine bundle.
        globalThis.Laya.RenderableSprite3D ||= class RenderableSprite3D {};
        globalThis.Laya.ControllerRef ||= class ControllerRef {};
        Module._load = function loadWithoutElectron(request) {
            if (request === "electron")
                return {};
            return originalLoad.apply(this, arguments);
        };
        globalThis.require = require;

        let gameSource = archive.read("game.js");
        const entry = `var __webpack_exports__=__webpack_require__(${GAME_ENTRY_MODULE})`;
        assert(gameSource.includes(entry), "AUTHORED_CONTENT_IDE_BUNDLE_ENTRY_MISSING");
        gameSource = gameSource.replace(entry, "globalThis.__authoredContentIdeRequire=__webpack_require__");
        vm.runInThisContext(gameSource, { filename: "LayaAirIDE-3.4.0-game.js" });

        const ideRequire = globalThis.__authoredContentIdeRequire;
        assert(typeof ideRequire === "function", "AUTHORED_CONTENT_IDE_MODULE_LOADER_MISSING");
        assert(ideRequire(ENGINE_EXTERNAL_MODULE) === globalThis.Laya, "AUTHORED_CONTENT_IDE_ENGINE_BINDING_MISMATCH");

        const typeRegistry = ideRequire(TYPE_REGISTRY_MODULE).typeRegistry;
        typeRegistry.addTypes(ideRequire(ENGINE_TYPES_MODULE).allTypes);
        ideRequire(ENGINE_TYPE_BINDINGS_MODULE).bindEngineTypes();

        const root = new globalThis.Laya.Node();
        root.name = "Root";
        const title = new globalThis.Laya.Node();
        title.name = "Title";
        root.addChild(title);

        const HierarchyWriter = ideRequire(HIERARCHY_WRITER_MODULE).HierarchyWriter;
        const hierarchy = HierarchyWriter.write(root, { creatingPrefab: true });
        assert(hierarchy._$ver === 1, "AUTHORED_CONTENT_LH_VERSION_MISSING");
        assert(hierarchy._$type === "Node", "AUTHORED_CONTENT_LH_ROOT_TYPE_INVALID");
        assert(hierarchy._$child?.[0]?.name === "Title", "AUTHORED_CONTENT_LH_CHILD_MISSING");

        // JSON serialization is the actual .lh file boundary used by the importer.
        const fileBoundary = JSON.parse(JSON.stringify(hierarchy));
        const errors = [];
        const parsedRoots = ideRequire(HIERARCHY_PARSER_MODULE).HierarchyParser.parse(fileBoundary, {}, errors);
        assert(errors.length === 0, `AUTHORED_CONTENT_LH_PARSE_ERRORS: ${errors.join("; ")}`);
        assert(parsedRoots.length === 1, "AUTHORED_CONTENT_LH_ROOT_COUNT_INVALID");
        assert(parsedRoots[0].name === "Root", "AUTHORED_CONTENT_LH_ROOT_NAME_LOST");
        assert(parsedRoots[0].getChildAt(0)?.name === "Title", "AUTHORED_CONTENT_LH_CHILD_NAME_LOST");

        const serializeErrors = [];
        const decoded = ideRequire(SERIALIZE_UTIL_MODULE).SerializeUtil.decodeObj(
            { _$type: "Node", name: "SerializeUtilProbe" },
            undefined,
            typeRegistry.types.Node,
            { outErrors: serializeErrors, strictTypeCheck: true }
        );
        assert(serializeErrors.length === 0, `AUTHORED_CONTENT_SERIALIZE_UTIL_ERRORS: ${serializeErrors.join("; ")}`);
        assert(decoded instanceof globalThis.Laya.Node, "AUTHORED_CONTENT_SERIALIZE_UTIL_NODE_INVALID");
        assert(decoded.name === "SerializeUtilProbe", "AUTHORED_CONTENT_SERIALIZE_UTIL_NAME_LOST");

        decoded.destroy();
        parsedRoots[0].destroy();
        root.destroy();
    }
    finally {
        Module._load = originalLoad;
        delete globalThis.__authoredContentIdeRequire;
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
        globalThis.Laya = previousLaya;
        globalThis.require = previousRequire;
    }
};

function resolveIdeResources() {
    if (process.env.LAYAAIR_IDE_RESOURCES)
        return path.resolve(process.env.LAYAAIR_IDE_RESOURCES);
    if (process.platform === "win32" && process.env.LOCALAPPDATA)
        return path.join(process.env.LOCALAPPDATA, "Programs", "LayaAirIDE", "resources");
    throw new Error("AUTHORED_CONTENT_IDE_RESOURCES_REQUIRED: Set LAYAAIR_IDE_RESOURCES to LayaAir IDE 3.4 resources.");
}

function readAsar(filePath) {
    const bytes = fs.readFileSync(filePath);
    const baseOffset = 8 + bytes.readUInt32LE(4);
    const headerLength = bytes.readUInt32LE(12);
    const header = JSON.parse(bytes.subarray(16, 16 + headerLength).toString("utf8"));
    return {
        read(relativePath) {
            let entry = header;
            for (const segment of relativePath.split("/"))
                entry = entry.files?.[segment];
            assert(entry && !entry.files, `AUTHORED_CONTENT_IDE_ARCHIVE_ENTRY_MISSING: ${relativePath}`);
            const start = baseOffset + Number(entry.offset);
            return bytes.subarray(start, start + entry.size).toString("utf8");
        }
    };
}

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
