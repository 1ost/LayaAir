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

exports.runIdeHierarchyRoundTrip = function runIdeHierarchyRoundTrip(
    content,
    NativeLayaEmitter,
    NativeAnimationClip2DWriter,
    bitmapContent,
    prepareNativeLayaHierarchy
) {
    const ideResources = resolveIdeResources();
    const archivePath = path.join(ideResources, "app.asar");
    const corePath = path.join(ideResources, "engine", "libs", "laya.core.js");
    const d3Path = path.join(ideResources, "engine", "libs", "laya.d3.js");
    const uiPath = path.join(ideResources, "engine", "libs", "laya.ui.js");
    const noRenderPath = path.join(ideResources, "engine", "libs", "laya.no-render.js");
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
        for (const libraryPath of [corePath, d3Path, uiPath, noRenderPath]) {
            delete require.cache[require.resolve(libraryPath)];
            require(libraryPath);
        }
        globalThis.Laya.Laya._beforeInitCallbacks.forEach(callback => callback({}));
        globalThis.Laya.ILaya.stage = {
            _graphicUpdateList: new Set(),
            _componentDriver: { _toDestroys: new Set() }
        };
        globalThis.Laya.ILaya.systemTimer = {
            callLater() {},
            runCallLater() {}
        };
        globalThis.Laya.ILaya.timer = {
            callLater() {},
            runCallLater() {}
        };
        globalThis.Laya.ILaya.loader = new globalThis.Laya.Loader();

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

        const clip = NativeLayaEmitter.createTimeline(content);
        const root = NativeLayaEmitter.createPrefabRoot(content, "timeline", clip);
        assert(root instanceof globalThis.Laya.Sprite, "AUTHORED_CONTENT_EMITTER_ROOT_NOT_SPRITE");
        assert(root.getChildAt(0) instanceof globalThis.Laya.Text, "AUTHORED_CONTENT_EMITTER_CHILD_NOT_TEXT");
        assert(root.getChildAt(0).name === "titleField", "AUTHORED_CONTENT_EMITTER_INSTANCE_NAME_LOST");
        const animator = root.getComponent(globalThis.Laya.AnimatorClip2D);
        assert(animator?.clip === clip, "AUTHORED_CONTENT_EMITTER_ANIMATOR_CLIP_MISSING");
        assert(clip.url === "res://timeline" && clip.uuid === "timeline", "AUTHORED_CONTENT_EMITTER_TIMELINE_REFERENCE_INVALID");

        const HierarchyWriter = ideRequire(HIERARCHY_WRITER_MODULE).HierarchyWriter;
        const hierarchy = HierarchyWriter.write(root, { creatingPrefab: true });
        hierarchy._$authoredContent = NativeLayaEmitter.createMetadata(content, "timeline");
        assert(hierarchy._$ver === 1, "AUTHORED_CONTENT_LH_VERSION_MISSING");
        assert(hierarchy._$type === "Sprite", "AUTHORED_CONTENT_LH_ROOT_TYPE_INVALID");
        assert(hierarchy._$child?.[0]?._$type === "Text", "AUTHORED_CONTENT_LH_TEXT_CHILD_MISSING");
        assert(hierarchy._$child?.[0]?.name === "titleField", "AUTHORED_CONTENT_LH_INSTANCE_NAME_MISSING");
        const animatorData = hierarchy._$comp?.find(component => component._$type === "AnimatorClip2D");
        assert(animatorData, "AUTHORED_CONTENT_LH_ANIMATOR_MISSING");
        assert(animatorData.clip?._$uuid === "timeline", "AUTHORED_CONTENT_LH_TIMELINE_REFERENCE_MISSING");
        assert(
            hierarchy._$authoredContent?.nodes?.[1]?.linkageClass === "Title",
            "AUTHORED_CONTENT_LH_LINKAGE_METADATA_MISSING"
        );

        const clipBytes = NativeAnimationClip2DWriter.write(clip);
        const parsedClip = globalThis.Laya.AnimationClip2D._parse(clipBytes);
        assert(parsedClip._frameRate === content.timeline.frameRate, "AUTHORED_CONTENT_MC_FRAME_RATE_LOST");
        assert(parsedClip._nodes.count === content.timeline.tracks.length, "AUTHORED_CONTENT_MC_TRACKS_LOST");
        const parsedTrack = parsedClip._nodes.getNodeByIndex(0);
        assert(parsedTrack.nodePath === "/titleField", "AUTHORED_CONTENT_MC_NAMED_INSTANCE_PATH_LOST");

        const clipType = globalThis.Laya.Loader.getURLInfo("timeline.mc");
        globalThis.Laya.Loader._cacheRes("timeline", clip, clipType.typeId, clipType.main);

        // JSON serialization is the actual .lh file boundary used by the importer.
        const fileBoundary = JSON.parse(JSON.stringify(hierarchy));
        const errors = [];
        const loaderStub = {
            async load() {
                return null;
            },
            getRes(url, type) {
                if (url === "timeline")
                    return clip;
                return globalThis.Laya.Loader.getRes(url, type);
            },
            clearRes(url, resource) {
                globalThis.Laya.Loader.clearRes(url, resource);
            }
        };
        globalThis.Laya.ILaya.loader = loaderStub;
        globalThis.Laya.Laya.loader = loaderStub;
        assert(
            typeof ideRequire(ENGINE_EXTERNAL_MODULE).ILaya.loader?.getRes === "function",
            "AUTHORED_CONTENT_IDE_LOADER_STUB_MISSING"
        );
        const parsedRoots = ideRequire(HIERARCHY_PARSER_MODULE).HierarchyParser.parse(fileBoundary, {}, errors);
        assert(
            errors.length === 0,
            `AUTHORED_CONTENT_LH_PARSE_ERRORS: ${errors.map(error => error?.stack || String(error)).join("; ")}`
        );
        assert(parsedRoots.length === 1, "AUTHORED_CONTENT_LH_ROOT_COUNT_INVALID");
        assert(parsedRoots[0] instanceof globalThis.Laya.Sprite, "AUTHORED_CONTENT_LH_PARSED_ROOT_NOT_SPRITE");
        assert(parsedRoots[0].name === "Root", "AUTHORED_CONTENT_LH_ROOT_NAME_LOST");
        assert(parsedRoots[0].getChildAt(0) instanceof globalThis.Laya.Text, "AUTHORED_CONTENT_LH_PARSED_CHILD_NOT_TEXT");
        assert(parsedRoots[0].getChildAt(0)?.name === "titleField", "AUTHORED_CONTENT_LH_CHILD_NAME_LOST");
        const parsedAnimator = parsedRoots[0].getComponent(globalThis.Laya.AnimatorClip2D);
        assert(parsedAnimator, "AUTHORED_CONTENT_LH_PARSED_ANIMATOR_MISSING");
        assert(parsedAnimator.clip === clip, "AUTHORED_CONTENT_LH_PARSED_TIMELINE_REFERENCE_LOST");

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

        if (bitmapContent) {
            assert(typeof prepareNativeLayaHierarchy === "function", "AUTHORED_CONTENT_BITMAP_HIERARCHY_WRITER_MISSING");
            const bitmapClip = NativeLayaEmitter.createTimeline(bitmapContent);
            const bitmapRoot = NativeLayaEmitter.createPrefabRoot(
                bitmapContent,
                "bitmap-timeline",
                bitmapClip,
                new Map([["hero", "hero-asset"]])
            );
            assert(bitmapRoot.getChildAt(0).name === "nestedSymbol", "AUTHORED_CONTENT_BITMAP_DEPTH_ORDER_LOST");
            assert(bitmapRoot.getChildAt(0).zOrder === 10, "AUTHORED_CONTENT_BITMAP_PARENT_DEPTH_LOST");
            const bitmapImage = bitmapRoot.getChildAt(0).getChildAt(0);
            assert(bitmapImage instanceof globalThis.Laya.Image, "AUTHORED_CONTENT_EMITTER_CHILD_NOT_IMAGE");
            assert(bitmapImage.name === "heroImage", "AUTHORED_CONTENT_BITMAP_INSTANCE_NAME_LOST");
            assert(bitmapImage.zOrder === 7, "AUTHORED_CONTENT_BITMAP_DEPTH_LOST");
            assert(bitmapImage.skin === "res://hero-asset", "AUTHORED_CONTENT_BITMAP_RESOURCE_IDENTITY_LOST");

            const rawBitmapHierarchy = HierarchyWriter.write(bitmapRoot, { creatingPrefab: true });
            const bitmapHierarchy = prepareNativeLayaHierarchy(
                bitmapContent,
                rawBitmapHierarchy,
                "bitmap-timeline",
                new Map([["hero", "hero-asset"]])
            );
            assert(bitmapHierarchy._$child[0]._$child[0]._$type === "Image", "AUTHORED_CONTENT_LH_IMAGE_CHILD_MISSING");
            assert(bitmapHierarchy._$child[0]._$child[0].skin === "res://hero-asset", "AUTHORED_CONTENT_LH_IMAGE_SKIN_MISSING");
            assert(bitmapHierarchy._$preloads.join(",") === "hero-asset,bitmap-timeline", "AUTHORED_CONTENT_LH_RESOURCE_CLOSURE_MISSING");
            const bitmapClipType = globalThis.Laya.Loader.getURLInfo("bitmap-timeline.mc");
            globalThis.Laya.Loader._cacheRes("bitmap-timeline", bitmapClip, bitmapClipType.typeId, bitmapClipType.main);
            const bitmapErrors = [];
            const parsedBitmapRoots = ideRequire(HIERARCHY_PARSER_MODULE).HierarchyParser.parse(
                JSON.parse(JSON.stringify(bitmapHierarchy)),
                {},
                bitmapErrors
            );
            assert(bitmapErrors.length === 0, `AUTHORED_CONTENT_BITMAP_LH_PARSE_ERRORS: ${bitmapErrors.join("; ")}`);
            const parsedBitmapRoot = parsedBitmapRoots[0];
            const parsedNested = parsedBitmapRoot.getChildAt(0);
            const parsedImage = parsedNested.getChildAt(0);
            const sourceNodes = [bitmapContent.root, bitmapContent.root.children[0], bitmapContent.root.children[0].children[0]];
            const parsedNodes = [parsedBitmapRoot, parsedNested, parsedImage];
            for (let index = 0; index < parsedNodes.length; index++) for (const field of ["x", "y", "width", "height", "alpha", "visible"])
                assert(parsedNodes[index][field] === sourceNodes[index][field], `AUTHORED_CONTENT_PARSED_${index}_${field.toUpperCase()}_LOST`);
            assert(parsedImage instanceof globalThis.Laya.Image, "AUTHORED_CONTENT_PARSED_IMAGE_MISSING");
            assert(parsedImage.name === "heroImage", "AUTHORED_CONTENT_PARSED_IMAGE_NAME_LOST");
            parsedBitmapRoots[0].destroy();
            bitmapRoot.destroy();
            bitmapClip.destroy();
        }

        decoded.destroy();
        parsedRoots[0].destroy();
        root.destroy();
        clip.destroy();
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
