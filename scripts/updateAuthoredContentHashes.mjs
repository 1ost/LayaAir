import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { logicalCompilerSignature } from "./checkAuthoredContentAdmission.mjs";

const supportedArguments = new Set(["--check"]);
for (const argument of process.argv.slice(2)) {
    if (!supportedArguments.has(argument))
        throw new Error(`Unsupported argument: ${argument}`);
}
const checkOnly = process.argv.includes("--check");
const root = path.resolve(import.meta.dirname, "..");
const ledgerPath = path.join(root, "docTool/architecture/authored-content-capabilities.json");
const runtimeTypeAuthorityRelative = "docTool/architecture/flash-runtime-type-predicates.json";
const runtimeTypeAuthorityPath = path.join(root, runtimeTypeAuthorityRelative);
const runtimeTypeAuthorityHashPath = path.join(root, "docTool/architecture/flash-runtime-type-predicates.sha256");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const runtimeTypeAuthority = JSON.parse(fs.readFileSync(runtimeTypeAuthorityPath, "utf8"));
if (ledger.hashMode !== "canonical-lf-utf8")
    throw new Error("Capability ledger must declare hashMode canonical-lf-utf8");

for (const [sourceQName, targetCapabilityId, targetModule, constructorExport, predicateExport] of [
    ["flash.display.Loader", "api.flash.display", "src/layaAir/flash/display/Loader.ts", "Loader", "isFlashLoader"],
    ["flash.display.LoaderInfo", "api.flash.display", "src/layaAir/flash/display/Loader.ts", "LoaderInfo", "isFlashLoaderInfo"],
    ["flash.display.Stage", "api.flash.display", "src/layaAir/flash/display/Stage.ts", "Stage", "isFlashStage"],
    ["flash.events.ContextMenuEvent", "api.flash.events", "src/layaAir/flash/events/ContextMenuEvent.ts", "ContextMenuEvent", "isFlashContextMenuEvent"],
    ["flash.events.HTTPStatusEvent", "api.flash.events", "src/layaAir/flash/events/HTTPStatusEvent.ts", "HTTPStatusEvent", "isFlashHTTPStatusEvent"],
    ["flash.events.UncaughtErrorEvent", "api.flash.events", "src/layaAir/flash/events/UncaughtErrorEvent.ts", "UncaughtErrorEvent", "isFlashUncaughtErrorEvent"],
    ["flash.net.FileReference", "api.flash.net", "src/layaAir/flash/net/FileReference.ts", "FileReference", "isFlashFileReference"],
    ["flash.net.LocalConnection", "api.flash.net", "src/layaAir/flash/net/LocalConnection.ts", "LocalConnection", "isFlashLocalConnection"],
    ["flash.net.SharedObject", "api.flash.net", "src/layaAir/flash/net/SharedObject.ts", "SharedObject", "isFlashSharedObject"],
    ["flash.net.Socket", "api.flash.net", "src/layaAir/flash/net/Socket.ts", "Socket", "isFlashSocket"],
    ["flash.net.URLLoader", "api.flash.net", "src/layaAir/flash/net/URLLoader.ts", "URLLoader", "isFlashURLLoader"],
    ["flash.net.URLVariables", "api.flash.net", "src/layaAir/flash/net/URLVariables.ts", "URLVariables", "isFlashURLVariables"],
]) {
    let entry = runtimeTypeAuthority.types.find(item => item.sourceQName === sourceQName);
    if (!entry) {
        entry = { sourceQName };
        runtimeTypeAuthority.types.push(entry);
    }
    Object.assign(entry, { targetCapabilityId, targetModule, constructorExport, predicateExport });
}
runtimeTypeAuthority.types.sort((left, right) => left.sourceQName.localeCompare(right.sourceQName));

const eventCapability = ledger.capabilities.find(item => item.id === "api.flash.events");
for (const [module, exported, kind = "class"] of [
    ["src/layaAir/flash/events/ContextMenuEvent.ts", "ContextMenuEvent"],
    ["src/layaAir/flash/events/FocusEvent.ts", "FocusEvent"],
    ["src/layaAir/flash/events/HTTPStatusEvent.ts", "HTTPStatusEvent"],
    ["src/layaAir/flash/events/IMEEvent.ts", "IMEEvent"],
    ["src/layaAir/flash/events/ProgressEvent.ts", "ProgressEvent"],
    ["src/layaAir/flash/events/SecurityErrorEvent.ts", "SecurityErrorEvent"],
    ["src/layaAir/flash/events/TextEvent.ts", "TextEvent"],
    ["src/layaAir/flash/events/UncaughtErrorEvent.ts", "UncaughtErrorEvent"],
    ["src/layaAir/flash/events/ContextMenuEvent.ts", "isFlashContextMenuEvent", "function"],
    ["src/layaAir/flash/events/ErrorEvent.ts", "isFlashErrorEvent", "function"],
    ["src/layaAir/flash/events/Event.ts", "isFlashEvent", "function"],
    ["src/layaAir/flash/events/EventDispatcher.ts", "IEventDispatcher", "interface"],
    ["src/layaAir/flash/events/EventDispatcher.ts", "isFlashEventDispatcher", "function"],
    ["src/layaAir/flash/events/FlashEventRouter.ts", "FlashEventListener", "type"],
    ["src/layaAir/flash/events/FlashEventRouter.ts", "NativeEventHost", "interface"],
    ["src/layaAir/flash/events/FocusEvent.ts", "isFlashFocusEvent", "function"],
    ["src/layaAir/flash/events/HTTPStatusEvent.ts", "isFlashHTTPStatusEvent", "function"],
    ["src/layaAir/flash/events/IOErrorEvent.ts", "isFlashIOErrorEvent", "function"],
    ["src/layaAir/flash/events/KeyboardEvent.ts", "isFlashKeyboardEvent", "function"],
    ["src/layaAir/flash/events/MouseEvent.ts", "isFlashMouseEvent", "function"],
    ["src/layaAir/flash/events/ProgressEvent.ts", "isFlashProgressEvent", "function"],
    ["src/layaAir/flash/events/SecurityErrorEvent.ts", "isFlashSecurityErrorEvent", "function"],
    ["src/layaAir/flash/events/TextEvent.ts", "isFlashTextEvent", "function"],
    ["src/layaAir/flash/events/TimerEvent.ts", "isFlashTimerEvent", "function"],
    ["src/layaAir/flash/events/UncaughtErrorEvent.ts", "isFlashUncaughtErrorEvent", "function"],
]) {
    if (!eventCapability.obligations.some(item => item.module === module && item.export === exported))
        eventCapability.obligations.push({ module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" });
}

const displayCapability = ledger.capabilities.find(item => item.id === "api.flash.display");
displayCapability.obligations = displayCapability.obligations.filter(item =>
    item.module !== "src/layaAir/flash/display/LoaderInfo.ts"
    && item.module !== "src/layaAir/flash/display/NativeLoaderContentHost.ts");
for (const [module, exported, kind = "class"] of [
    ["src/layaAir/flash/display/FlashDisplayRootBoundary.ts", "FlashDisplayRootBoundary"],
    ["src/layaAir/flash/display/FlashDisplayRootBoundary.ts", "FlashDisplayRootLease", "interface"],
    ["src/layaAir/flash/display/FlashDisplayRootBoundary.ts", "FlashDisplayRootOptions", "interface"],
    ["src/layaAir/flash/display/FlashStageBoundary.ts", "FlashStageBoundary"],
    ["src/layaAir/flash/display/Bitmap.ts", "Bitmap"],
    ["src/layaAir/flash/display/BitmapData.ts", "BitmapData"],
    ["src/layaAir/flash/display/BitmapDataChannel.ts", "BitmapDataChannel"],
    ["src/layaAir/flash/display/PixelSnapping.ts", "PixelSnapping"],
    ["src/layaAir/flash/display/StageAlign.ts", "StageAlign"],
    ["src/layaAir/flash/display/GradientType.ts", "GradientType"],
    ["src/layaAir/flash/display/BlendMode.ts", "BlendMode"],
    ["src/layaAir/flash/display/StageQuality.ts", "StageQuality"],
    ["src/layaAir/flash/display/StageScaleMode.ts", "StageScaleMode"],
    ["src/layaAir/flash/display/Stage.ts", "Stage"],
    ["src/layaAir/flash/display/Stage.ts", "FlashStageLoaderInfo", "interface"],
    ["src/layaAir/flash/display/Stage.ts", "isFlashStage", "function"],
    ["src/layaAir/flash/display/Bitmap.ts", "isFlashBitmap", "function"],
    ["src/layaAir/flash/display/BitmapData.ts", "acquireBitmapDataTexture", "function"],
    ["src/layaAir/flash/display/BitmapData.ts", "isFlashBitmapData", "function"],
    ["src/layaAir/flash/display/BitmapData.ts", "observeBitmapData", "function"],
    ["src/layaAir/flash/display/DisplayObject.ts", "isFlashDisplayObject", "function"],
    ["src/layaAir/flash/display/DisplayObjectContainer.ts", "isFlashDisplayObjectContainer", "function"],
    ["src/layaAir/flash/display/FlashStageBoundary.ts", "FlashStageBootstrap", "interface"],
    ["src/layaAir/flash/display/FlashStageBoundary.ts", "FlashStageBootstrapOptions", "interface"],
    ["src/layaAir/flash/display/FlashStageBoundary.ts", "FlashStageViewport", "interface"],
    ["src/layaAir/flash/display/FlashStageBoundary.ts", "FlashStageViewportOwner", "interface"],
    ["src/layaAir/flash/display/Graphics.ts", "FlashGraphicsRasterCommand", "interface"],
    ["src/layaAir/flash/display/Graphics.ts", "flashGraphicsRasterCommands", "function"],
    ["src/layaAir/flash/display/Graphics.ts", "isFlashGraphics", "function"],
    ["src/layaAir/flash/display/Graphics.ts", "sampleFlashGraphicsFill", "function"],
    ["src/layaAir/flash/display/IBitmapDrawable.ts", "IBitmapDrawable", "type"],
    ["src/layaAir/flash/display/InteractiveObject.ts", "isFlashInteractiveObject", "function"],
    ["src/layaAir/flash/display/InteractiveObject.ts", "resolveFlashFocusOwner", "function"],
    ["src/layaAir/flash/display/MovieClip.ts", "FlashFrameReference", "type"],
    ["src/layaAir/flash/display/MovieClip.ts", "FlashFrameScript", "type"],
    ["src/layaAir/flash/display/MovieClip.ts", "isFlashMovieClip", "function"],
    ["src/layaAir/flash/display/Loader.ts", "Loader"],
    ["src/layaAir/flash/display/Loader.ts", "isFlashLoader", "function"],
    ["src/layaAir/flash/display/Loader.ts", "LoaderInfo"],
    ["src/layaAir/flash/display/Loader.ts", "isFlashLoaderInfo", "function"],
    ["src/layaAir/flash/display/Loader.ts", "NativeLoaderContentHost"],
    ["src/layaAir/flash/display/Loader.ts", "NativeLoaderContentSource"],
    ["src/layaAir/flash/display/Loader.ts", "installNativeLoaderContentHost", "function"],
    ["src/layaAir/flash/display/Loader.ts", "isNativeLoaderContentHost", "function"],
    ["src/layaAir/flash/display/NativeMovieClipTimeline.ts", "NativeMovieClipTimeline", "interface"],
    ["src/layaAir/flash/display/Shape.ts", "isFlashShape", "function"],
    ["src/layaAir/flash/display/SimpleButton.ts", "isFlashSimpleButton", "function"],
    ["src/layaAir/flash/display/Sprite.ts", "isFlashSprite", "function"],
]) {
    if (!displayCapability.obligations.some(item => item.module === module && item.export === exported))
        displayCapability.obligations.push({ module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" });
}

const textCapability = ledger.capabilities.find(item => item.id === "api.flash.text");
const textSubjects = [
    ["src/layaAir/flash/text/Font.ts", "FlashFontClass", "interface"],
    ["src/layaAir/flash/text/Font.ts", "FlashFontRegistration", "interface"],
    ["src/layaAir/flash/text/Font.ts", "Font", "class"],
    ["src/layaAir/flash/text/StaticText.ts", "StaticText"],
    ["src/layaAir/flash/text/StaticText.ts", "isFlashStaticText", "function"],
    ["src/layaAir/flash/text/TextField.ts", "TextField"],
    ["src/layaAir/flash/text/TextField.ts", "flashHtmlToText"],
    ["src/layaAir/flash/text/TextField.ts", "flashTextToHtml"],
    ["src/layaAir/flash/text/TextField.ts", "isFlashTextField"],
    ["src/layaAir/flash/text/TextFormat.ts", "AntiAliasType"],
    ["src/layaAir/flash/text/TextFormat.ts", "CSMSettings"],
    ["src/layaAir/flash/text/TextFormat.ts", "FontStyle"],
    ["src/layaAir/flash/text/TextFormat.ts", "GridFitType"],
    ["src/layaAir/flash/text/TextFormat.ts", "isFlashCSMSettings"],
    ["src/layaAir/flash/text/TextFormat.ts", "isFlashTextFormat"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextColorType"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextDisplayMode"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextFieldAutoSize"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextFieldType"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextFormat"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextFormatAlign"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextLineMetrics"],
    ["src/layaAir/flash/text/TextFormat.ts", "TextRenderer"],
    ["src/layaAir/flash/text/FontType.ts", "FontType"],
];
const textSubjectKeys = new Set(textSubjects.map(([module, exported]) => `${module}\u0000${exported}`));
textCapability.obligations = textCapability.obligations.filter(item =>
    !item.module.startsWith("src/layaAir/flash/text/")
    || textSubjectKeys.has(`${item.module}\u0000${item.export}`));
for (const [module, exported, declaredKind] of textSubjects) {
    if (!textCapability.obligations.some(item => item.module === module && item.export === exported))
        textCapability.obligations.push({ module, export: exported,
            kind: declaredKind || (exported.startsWith("flash") || exported.startsWith("isFlash") ? "function" : "class"),
            signature: "", ...(declaredKind === "interface" ? {} : { members: [], constructors: [], indexSignatures: [] }),
            sha256: "" });
}

let authoredDeviceTextCapability = ledger.capabilities.find(item =>
    item.id === "text.authored-device-field-configuration");
if (!authoredDeviceTextCapability) {
    authoredDeviceTextCapability = { id: "text.authored-device-field-configuration" };
    ledger.capabilities.push(authoredDeviceTextCapability);
}
Object.assign(authoredDeviceTextCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/extensions/authoredContent/runtime/AuthoredTextField.ts", "AuthoredTextFormatConfiguration", "interface"],
        ["src/extensions/authoredContent/runtime/AuthoredTextField.ts", "AuthoredTextFieldConfiguration", "interface"],
        ["src/extensions/authoredContent/runtime/AuthoredTextField.ts", "createAuthoredTextField", "function"],
    ].map(([module, exported, kind]) => authoredDeviceTextCapability.obligations?.find(
        item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "", sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashTextBridgeEvidence.test.ts",
        test: "Authored device TextField configuration compiler surface",
        sha256: "",
        capability: "text.authored-device-field-configuration",
        covers: [],
    }],
});
delete authoredDeviceTextCapability.blockingReason;

let authoredFontCapability = ledger.capabilities.find(item => item.id === "text.authored-font-registry");
if (!authoredFontCapability) {
    authoredFontCapability = { id: "text.authored-font-registry" };
    ledger.capabilities.push(authoredFontCapability);
}
Object.assign(authoredFontCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/laya/platform/AuthoredFontRegistry.ts", "AuthoredFontBinding", "interface"],
        ["src/layaAir/laya/platform/AuthoredFontRegistry.ts", "AuthoredFontBindingCancelledError", "class"],
        ["src/layaAir/laya/platform/AuthoredFontRegistry.ts", "AuthoredFontKey", "interface"],
        ["src/layaAir/laya/platform/AuthoredFontRegistry.ts", "AuthoredFontManifest", "interface"],
        ["src/layaAir/laya/platform/AuthoredFontRegistry.ts", "AuthoredFontManifestEntry", "interface"],
        ["src/layaAir/laya/platform/AuthoredFontRegistry.ts", "AuthoredFontRegistry", "class"],
        ["src/layaAir/laya/platform/AuthoredFontRegistry.ts", "AuthoredTextProviderConsumer", "interface"],
    ].map(([module, exported, kind]) => authoredFontCapability.obligations?.find(
        item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "", sha256: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}) }),
    evidence: [{
        path: "tests/architecture/authoredFontRegistryEvidence.test.ts",
        test: "Authored font registry compiler surface",
        sha256: "",
        capability: "text.authored-font-registry",
        covers: [],
    }],
});
delete authoredFontCapability.blockingReason;

const mediaFontCapability = ledger.capabilities.find(item => item.id === "media.font");
if (!mediaFontCapability || mediaFontCapability.status !== "blocking")
    throw new Error("The narrow authored-font registry may not clear broad media.font admission");
mediaFontCapability.blockingReason = "The authored-font registry admits immutable converted manifests and exact text providers only; broad platform font-media coverage remains unresolved.";

let authoredStaticTextCapability = ledger.capabilities.find(item =>
    item.id === "text.authored-static-text-texture-foundation");
if (!authoredStaticTextCapability) {
    authoredStaticTextCapability = { id: "text.authored-static-text-texture-foundation" };
    ledger.capabilities.push(authoredStaticTextCapability);
}
Object.assign(authoredStaticTextCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/flash/text/StaticText.ts", "AuthoredStaticGlyphConfiguration", "interface"],
        ["src/layaAir/flash/text/StaticText.ts", "AuthoredStaticGlyphRunConfiguration", "interface"],
        ["src/layaAir/flash/text/StaticText.ts", "AuthoredStaticTextConfiguration", "interface"],
        ["src/layaAir/flash/text/StaticText.ts", "createAuthoredStaticText", "function"],
    ].map(([module, exported, kind]) => authoredStaticTextCapability.obligations?.find(
        item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "", sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashTextBridgeEvidence.test.ts",
        test: "Authored texture-backed StaticText configuration compiler surface",
        sha256: "",
        capability: "text.authored-static-text-texture-foundation",
        covers: [],
    }],
});
delete authoredStaticTextCapability.blockingReason;

const broadStaticGlyphCapability = ledger.capabilities.find(item => item.id === "text.static-glyph-runs");
Object.assign(broadStaticGlyphCapability, {
    status: "blocking",
    blockingReason: "Texture-backed StaticText publication is admitted, but native prefab serialization, source glyph extraction, embedded-font semantics, outline conversion and generic glyph-run emission remain explicitly unsupported.",
});
delete broadStaticGlyphCapability.artifacts;
delete broadStaticGlyphCapability.obligations;
delete broadStaticGlyphCapability.evidence;

const geometryCapability = ledger.capabilities.find(item => item.id === "api.flash.geom");
const geometrySubjects = [
    ["src/layaAir/flash/geom/Point.ts", "Point"],
    ["src/layaAir/flash/geom/Rectangle.ts", "Rectangle"],
    ["src/layaAir/flash/geom/Matrix.ts", "Matrix"],
    ["src/layaAir/flash/geom/ColorTransform.ts", "ColorTransform"],
    ["src/layaAir/flash/geom/Transform.ts", "Transform"],
    ["src/layaAir/flash/geom/Point.ts", "isFlashPoint", "function"],
    ["src/layaAir/flash/geom/Rectangle.ts", "isFlashRectangle", "function"],
    ["src/layaAir/flash/geom/Matrix.ts", "isFlashMatrix", "function"],
    ["src/layaAir/flash/geom/ColorTransform.ts", "isFlashColorTransform", "function"],
    ["src/layaAir/flash/geom/Transform.ts", "isFlashTransform", "function"],
    ["src/layaAir/flash/geom/Transform.ts", "synchronizeDisplayObjectAlpha", "function"],
    ["src/layaAir/flash/geom/Transform.ts", "transformForDisplayObject", "function"],
    ["src/layaAir/flash/geom/Transform.ts", "applyTransformToDisplayObject", "function"],
    ["src/layaAir/flash/geom/Transform.ts", "getDisplayObjectFilters", "function"],
    ["src/layaAir/flash/geom/Transform.ts", "setDisplayObjectFilters", "function"],
];
Object.assign(geometryCapability, {
    status: "typescript-obligation",
    obligations: geometrySubjects.map(([module, exported, kind = "class"]) =>
        geometryCapability.obligations?.find(item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashGeometryBridgeEvidence.test.ts",
        test: "Flash geometry bridge compiler surface",
        sha256: "",
        capability: "api.flash.geom",
        covers: [],
    }],
    heldSurfaces: [
        { surface: "flash.geom.Matrix3D", reason: "HOLD: no maintained Bleach application source use or independent 3D display evidence." },
        { surface: "flash.geom.PerspectiveProjection", reason: "HOLD: no maintained Bleach application source use or independent perspective evidence." },
        { surface: "flash.geom.Transform.matrix3D", reason: "HOLD: 3D transform state is not source-used or independently evidenced." },
        { surface: "flash.geom.Transform.perspectiveProjection", reason: "HOLD: perspective state is not source-used or independently evidenced." },
        { surface: "flash.geom.Transform.pixelBounds", reason: "HOLD: transformed pixel bounds are not source-used and lack an independent render-bounds oracle." },
    ],
});
delete geometryCapability.blockingReason;

const renderingTransformCapability = ledger.capabilities.find(item => item.id === "rendering.transform");
Object.assign(renderingTransformCapability, {
    status: "native",
    artifacts: [
        ["src/layaAir/laya/maths/Matrix.ts", "Matrix"],
        ["src/layaAir/flash/geom/Matrix.ts", "Matrix"],
        ["src/layaAir/flash/geom/Transform.ts", "Transform"],
        ["src/layaAir/flash/display/DisplayObject.ts", "DisplayObject"],
    ].map(([path, exported]) => renderingTransformCapability.artifacts?.find(
        item => item.path === path && item.export === exported) || { path, export: exported, sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashGeometryBridgeEvidence.test.ts",
        test: "Flash native transform synchronization surface",
        sha256: "",
        capability: "rendering.transform",
        covers: [],
    }],
});
delete renderingTransformCapability.blockingReason;

const renderingColorTransformCapability = ledger.capabilities.find(item => item.id === "rendering.color-transform");
Object.assign(renderingColorTransformCapability, {
    status: "native",
    artifacts: [
        ["src/layaAir/flash/geom/ColorTransform.ts", "ColorTransform"],
        ["src/layaAir/flash/geom/Transform.ts", "Transform"],
        ["src/layaAir/flash/display/DisplayObject.ts", "DisplayObject"],
    ].map(([path, exported]) => renderingColorTransformCapability.artifacts?.find(
        item => item.path === path && item.export === exported) || { path, export: exported, sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashGeometryBridgeEvidence.test.ts",
        test: "Flash native color-transform browser oracle surface",
        sha256: "",
        capability: "rendering.color-transform",
        covers: [],
    }],
});
delete renderingColorTransformCapability.blockingReason;

for (const [sourceQName, targetModule, constructorExport, predicateExport] of [
    ["flash.geom.Matrix", "src/layaAir/flash/geom/Matrix.ts", "Matrix", "isFlashMatrix"],
    ["flash.geom.ColorTransform", "src/layaAir/flash/geom/ColorTransform.ts", "ColorTransform", "isFlashColorTransform"],
    ["flash.geom.Transform", "src/layaAir/flash/geom/Transform.ts", "Transform", "isFlashTransform"],
]) {
    if (!runtimeTypeAuthority.types.some(item => item.sourceQName === sourceQName))
        runtimeTypeAuthority.types.push({ sourceQName, targetCapabilityId: "api.flash.geom", targetModule,
            constructorExport, constructorSignature: "", constructSignatures: [], predicateExport,
            predicateSignature: "", heritageClosure: [], moduleSha256: "" });
}

const netCapability = ledger.capabilities.find(item => item.id === "api.flash.net");
const netSubjects = [
    ["src/layaAir/flash/net/URLRequest.ts", "URLRequest", "class"],
    ["src/layaAir/flash/net/URLRequest.ts", "navigateToURL", "function"],
    ["src/layaAir/flash/net/URLRequest.ts", "URLRequestHeader", "interface"],
    ["src/layaAir/flash/net/URLRequest.ts", "FlashURLRequestSnapshot", "interface"],
    ["src/layaAir/flash/net/URLRequest.ts", "isFlashURLRequest", "function"],
    ["src/layaAir/flash/net/URLRequest.ts", "snapshotNativeLoaderRequest", "function"],
    ["src/layaAir/flash/net/URLRequest.ts", "snapshotFlashURLRequest", "function"],
    ["src/layaAir/flash/net/URLLoaderDataFormat.ts", "URLLoaderDataFormat", "class"],
    ["src/layaAir/flash/net/URLVariables.ts", "URLVariables", "class"],
    ["src/layaAir/flash/net/URLVariables.ts", "isFlashURLVariables", "function"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "FlashHTTPRequest", "interface"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "FlashHTTPResponse", "interface"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "FlashHTTPProgressObserver", "type"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "FlashHTTPStatusObserver", "type"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "FlashHTTPHost", "class"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "installFlashHTTPHost", "function"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "isFlashHTTPHost", "function"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "requireFlashHTTPHost", "function"],
    ["src/layaAir/flash/net/FlashHTTPTransport.ts", "prepareFlashHTTPRequest", "function"],
    ["src/layaAir/flash/net/URLLoader.ts", "URLLoader", "class"],
    ["src/layaAir/flash/net/URLLoader.ts", "isFlashURLLoader", "function"],
    ["src/layaAir/flash/net/sendToURL.ts", "sendToURL", "function"],
    ["src/layaAir/flash/net/SharedObject.ts", "FlashSharedObjectStorageHost", "class"],
    ["src/layaAir/flash/net/SharedObject.ts", "installFlashSharedObjectStorageHost", "function"],
    ["src/layaAir/flash/net/SharedObject.ts", "SharedObject", "class"],
    ["src/layaAir/flash/net/SharedObject.ts", "isFlashSharedObject", "function"],
    ["src/layaAir/flash/net/LocalConnection.ts", "LocalConnection", "class"],
    ["src/layaAir/flash/net/LocalConnection.ts", "isFlashLocalConnection", "function"],
    ["src/layaAir/flash/net/FileReference.ts", "FlashFileDownload", "interface"],
    ["src/layaAir/flash/net/FileReference.ts", "FlashFileDownloadHost", "class"],
    ["src/layaAir/flash/net/FileReference.ts", "installFlashFileDownloadHost", "function"],
    ["src/layaAir/flash/net/FileReference.ts", "FileReference", "class"],
    ["src/layaAir/flash/net/FileReference.ts", "isFlashFileReference", "function"],
    ["src/layaAir/flash/net/Socket.ts", "FlashSocketCallbacks", "interface"],
    ["src/layaAir/flash/net/Socket.ts", "FlashSocketConnection", "interface"],
    ["src/layaAir/flash/net/Socket.ts", "FlashSocketConnectOptions", "interface"],
    ["src/layaAir/flash/net/Socket.ts", "FlashSocketHost", "class"],
    ["src/layaAir/flash/net/Socket.ts", "installFlashSocketHost", "function"],
    ["src/layaAir/flash/net/Socket.ts", "Socket", "class"],
    ["src/layaAir/flash/net/Socket.ts", "isFlashSocket", "function"],
    ["src/layaAir/flash/net/ClassAlias.ts", "NativeClassConstructor", "type"],
    ["src/layaAir/flash/net/ClassAlias.ts", "registerClassAlias", "function"],
    ["src/layaAir/flash/net/ClassAlias.ts", "resolveClassAlias", "function"],
    ["src/layaAir/flash/net/ClassAlias.ts", "resolveAliasForClass", "function"],
];
netCapability.obligations = netSubjects.map(([module, exported, kind]) =>
    netCapability.obligations.find(item => item.module === module && item.export === exported)
    || { module, export: exported, kind, signature: "", ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" });

const utilsCapability = ledger.capabilities.find(item => item.id === "api.flash.utils");
Object.assign(utilsCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/flash/utils/Timer.ts", "Timer", "class"],
        ["src/layaAir/flash/utils/Timer.ts", "isFlashTimer", "function"],
        ["src/layaAir/flash/utils/TimerFunctions.ts", "getTimer", "function"],
        ["src/layaAir/flash/utils/TimerFunctions.ts", "setTimeout", "function"],
        ["src/layaAir/flash/utils/TimerFunctions.ts", "clearTimeout", "function"],
        ["src/layaAir/flash/utils/TimerFunctions.ts", "setInterval", "function"],
        ["src/layaAir/flash/utils/TimerFunctions.ts", "clearInterval", "function"],
        ["src/layaAir/flash/utils/Endian.ts", "Endian", "class"],
        ["src/layaAir/flash/utils/ByteArray.ts", "ByteArray", "class"],
        ["src/layaAir/flash/utils/ByteArray.ts", "ByteArrayInput", "type"],
        ["src/layaAir/flash/utils/ByteArray.ts", "ZlibDecompressionHost", "interface"],
        ["src/layaAir/flash/utils/Dictionary.ts", "Dictionary", "class"],
        ["src/layaAir/flash/utils/Proxy.ts", "Proxy", "class"],
        ["src/layaAir/flash/utils/Proxy.ts", "flash_proxy", "const"],
        ["src/layaAir/flash/utils/Proxy.ts", "FlashProxyName", "type"],
        ["src/layaAir/flash/utils/Proxy.ts", "declareFlashProxyProperties", "function"],
        ["src/layaAir/flash/utils/Proxy.ts", "callFlashProxyProperty", "function"],
        ["src/layaAir/flash/utils/XML.ts", "XML", "class"],
        ["src/layaAir/flash/utils/XML.ts", "XMLList", "class"],
        ["src/layaAir/flash/utils/XML.ts", "FlashXmlInput", "type"],
        ["src/layaAir/flash/utils/XML.ts", "FlashXmlChild", "type"],
        ["src/layaAir/flash/utils/NativeObjectCodec.ts", "encodeNativeObject", "function"],
        ["src/layaAir/flash/utils/NativeObjectCodec.ts", "decodeNativeObject", "function"],
        ["src/layaAir/flash/utils/getQualifiedClassName.ts", "getQualifiedClassName", "function"],
        ["src/layaAir/flash/utils/getQualifiedSuperclassName.ts", "getQualifiedSuperclassName", "function"],
        ["src/layaAir/flash/utils/DefinitionRegistry.ts", "getDefinitionByName", "function"],
        ["src/layaAir/flash/utils/DefinitionRegistry.ts", "registerDefinitionByName", "function"],
        ["src/layaAir/flash/utils/DefinitionRegistry.ts", "registerObservedDefinition", "function"],
        ["src/layaAir/flash/utils/DefinitionRegistry.ts", "NativeDefinition", "type"],
        ["src/layaAir/flash/utils/describeType.ts", "describeType", "function"],
        ["src/layaAir/flash/utils/describeType.ts", "FlashAccessorAccess", "type"],
        ["src/layaAir/flash/utils/describeType.ts", "FlashAccessorDescription", "interface"],
        ["src/layaAir/flash/utils/describeType.ts", "FlashMethodDescription", "interface"],
        ["src/layaAir/flash/utils/describeType.ts", "FlashTypeDescription", "interface"],
        ["src/layaAir/flash/utils/describeType.ts", "FlashTypeMembers", "interface"],
        ["src/layaAir/flash/utils/describeType.ts", "FlashVariableDescription", "interface"],
    ].map(([module, exported, kind]) =>
        utilsCapability.obligations?.find(item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashUtilsBridgeEvidence.test.ts",
        test: "Flash utils compiler and runtime surface",
        sha256: "",
        capability: "api.flash.utils",
        covers: [],
    }, {
        path: "tests/flashXml/flash-xml.runner.ts",
        test: "Mutable Flash XML and XMLList behavior",
        sha256: "",
        capability: "api.flash.utils",
        covers: [],
    }, {
        path: "tests/flashByteArray/flash-byte-array.runner.ts",
        test: "Flash ByteArray binary and synchronous zlib behavior",
        sha256: "",
        capability: "api.flash.utils",
        covers: [],
    }, {
        path: "tests/flashByteArray/flash-byte-array.browser.ts",
        test: "Flash ByteArray browser zlib behavior",
        sha256: "",
        capability: "api.flash.utils",
        covers: [],
    }],
});
delete utilsCapability.blockingReason;

let uiCapability = ledger.capabilities.find(item => item.id === "api.flash.ui");
if (!uiCapability) {
    uiCapability = { id: "api.flash.ui", status: "typescript-obligation", obligations: [], evidence: [] };
    ledger.capabilities.push(uiCapability);
}
Object.assign(uiCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/flash/ui/MouseCursor.ts", "MouseCursor", "class"],
        ["src/layaAir/flash/ui/Keyboard.ts", "Keyboard", "class"],
        ["src/layaAir/flash/ui/Keyboard.ts", "FlashKeyboardStateLease", "interface"],
        ["src/layaAir/flash/ui/Keyboard.ts", "installNativeKeyboardStateHost", "function"],
        ["src/layaAir/flash/ui/Mouse.ts", "Mouse", "class"],
        ["src/layaAir/flash/ui/ContextMenu.ts", "ContextMenu", "class"],
        ["src/layaAir/flash/ui/ContextMenu.ts", "ContextMenuItem", "class"],
        ["src/layaAir/flash/ui/ContextMenu.ts", "ContextMenuBuiltInItems", "interface"],
        ["src/layaAir/flash/ui/NativeContextMenuHost.ts", "NativeContextMenuHostOptions", "interface"],
        ["src/layaAir/flash/ui/NativeContextMenuHost.ts", "NativeContextMenuHostLease", "interface"],
        ["src/layaAir/flash/ui/NativeContextMenuHost.ts", "installNativeContextMenuHost", "function"],
        ["src/layaAir/flash/ui/ContextMenu.ts", "isFlashContextMenu", "function"],
        ["src/layaAir/flash/ui/ContextMenu.ts", "isFlashContextMenuItem", "function"],
    ].map(
        ([module, exported, kind]) => uiCapability.obligations?.find(
            item => item.module === module && item.export === exported)
            || { module, export: exported, kind, signature: "",
                ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashUiHostBridgeEvidence.test.ts",
        test: "Flash UI host compiler surface and browser producer ownership",
        sha256: "",
        capability: "api.flash.ui",
        covers: [],
    }],
    heldSurfaces: [
        { surface: "flash.ui.Mouse.registerCursor", reason: "HOLD: custom bitmap and animated cursors are not source-used and lack a cross-platform Laya cursor artifact contract." },
        { surface: "flash.ui.ContextMenu built-in items", reason: "HOLD: browsers do not permit replacement or augmentation of their native built-in context menu; retained game code hides every built-in item." },
        { surface: "flash.ui.ContextMenu clipboardItems", reason: "HOLD: retained game code does not use AIR clipboard-menu population and browsers do not expose an equivalent native menu surface." },
        { surface: "flash.ui.ContextMenu on non-DOM platforms", reason: "HOLD: the source-used custom menu is implemented by the browser DOM producer; native and mini-game shells require a platform-owned menu host." },
    ],
});
delete uiCapability.blockingReason;

let desktopCapability = ledger.capabilities.find(item => item.id === "api.flash.desktop");
if (!desktopCapability) {
    desktopCapability = { id: "api.flash.desktop" };
    ledger.capabilities.push(desktopCapability);
}
Object.assign(desktopCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/flash/desktop/Clipboard.ts", "Clipboard", "class"],
        ["src/layaAir/flash/desktop/Clipboard.ts", "NativeClipboardHost", "interface"],
        ["src/layaAir/flash/desktop/Clipboard.ts", "NativeClipboardHostLease", "interface"],
        ["src/layaAir/flash/desktop/Clipboard.ts", "installNativeClipboardHost", "function"],
        ["src/layaAir/flash/desktop/Clipboard.ts", "createBrowserClipboardHost", "function"],
        ["src/layaAir/flash/desktop/ClipboardFormats.ts", "ClipboardFormats", "class"],
    ].map(([module, exported, kind]) => desktopCapability.obligations?.find(
        item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashUiHostBridgeEvidence.test.ts",
        test: "Flash desktop clipboard compiler surface and browser producer ownership",
        sha256: "", capability: "api.flash.desktop", covers: [],
    }],
    heldSurfaces: [
        { surface: "flash.desktop.Clipboard reads", reason: "HOLD: browser clipboard reads are asynchronous, permission-gated and cannot truthfully satisfy AIR's synchronous API." },
        { surface: "flash.desktop.Clipboard non-text formats", reason: "HOLD: retained source publishes text only and no independently authenticated browser serialization contract exists for other AIR formats." },
        { surface: "flash.desktop non-Clipboard APIs", reason: "HOLD: this capability admits only the source-used clipboard boundary; native process, tray, application and filesystem actions remain separate platform work." },
    ],
});
delete desktopCapability.blockingReason;

let accessibilityCapability = ledger.capabilities.find(item => item.id === "api.flash.accessibility");
if (!accessibilityCapability) {
    accessibilityCapability = { id: "api.flash.accessibility" };
    ledger.capabilities.push(accessibilityCapability);
}
Object.assign(accessibilityCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/flash/accessibility/AccessibilityProperties.ts", "AccessibilityProperties", "class"],
        ["src/layaAir/flash/accessibility/AccessibilityProperties.ts", "AccessibilityPropertiesBinding", "interface"],
        ["src/layaAir/flash/accessibility/AccessibilityProperties.ts", "bindAccessibilityProperties", "function"],
        ["src/layaAir/flash/accessibility/AccessibilityProperties.ts", "isFlashAccessibilityProperties", "function"],
    ].map(([module, exported, kind]) => accessibilityCapability.obligations?.find(
        item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashUiHostBridgeEvidence.test.ts",
        test: "Flash accessibility metadata compiler surface and DOM binding ownership",
        sha256: "", capability: "api.flash.accessibility", covers: [],
    }],
    heldSurfaces: [{
        surface: "automatic canvas accessibility-tree projection",
        reason: "HOLD: the generic property/binding seam is admitted, but display geometry and action projection require a higher-level authored accessibility host.",
    }],
});
delete accessibilityCapability.blockingReason;

for (const [sourceQName, targetCapabilityId, targetModule, constructorExport, predicateExport] of [
    ["flash.ui.ContextMenu", "api.flash.ui", "src/layaAir/flash/ui/ContextMenu.ts", "ContextMenu", "isFlashContextMenu"],
    ["flash.ui.ContextMenuItem", "api.flash.ui", "src/layaAir/flash/ui/ContextMenu.ts", "ContextMenuItem", "isFlashContextMenuItem"],
    ["flash.accessibility.AccessibilityProperties", "api.flash.accessibility", "src/layaAir/flash/accessibility/AccessibilityProperties.ts", "AccessibilityProperties", "isFlashAccessibilityProperties"],
]) {
    if (!runtimeTypeAuthority.types.some(item => item.sourceQName === sourceQName))
        runtimeTypeAuthority.types.push({ sourceQName, targetCapabilityId, targetModule,
            constructorExport, constructorSignature: "", constructSignatures: [], predicateExport,
            predicateSignature: "", heritageClosure: [], moduleSha256: "" });
}

let filterCapability = ledger.capabilities.find(item => item.id === "api.flash.filters");
if (!filterCapability) {
    filterCapability = {
        id: "api.flash.filters",
        status: "typescript-obligation",
        obligations: [],
        evidence: [{
            path: "tests/architecture/flashFiltersBridgeEvidence.test.ts",
            test: "Flash filter bridge compiler surface and native effect ownership",
            sha256: "",
            capability: "api.flash.filters",
            covers: [],
        }],
    };
    ledger.capabilities.push(filterCapability);
}
const filterSubjects = [
    ["src/layaAir/flash/filters/BitmapFilter.ts", "BitmapFilter", "class"],
    ["src/layaAir/flash/filters/BitmapFilter.ts", "bitmapFilterNumberEquals", "function"],
    ["src/layaAir/flash/filters/BlurFilter.ts", "BlurFilter", "class"],
    ["src/layaAir/flash/filters/BlurFilter.ts", "isBlurFilter", "function"],
    ["src/layaAir/flash/filters/ColorMatrixFilter.ts", "ColorMatrixFilter", "class"],
    ["src/layaAir/flash/filters/ColorMatrixFilter.ts", "isColorMatrixFilter", "function"],
    ["src/layaAir/flash/filters/DropShadowFilter.ts", "DropShadowFilter", "class"],
    ["src/layaAir/flash/filters/DropShadowFilter.ts", "isDropShadowFilter", "function"],
    ["src/layaAir/flash/filters/FilterProxy.ts", "FilterProxy", "class"],
    ["src/layaAir/flash/filters/FilterRegistry.ts", "bitmapFilterEquals", "function"],
    ["src/layaAir/flash/filters/FilterRegistry.ts", "isBitmapFilter", "function"],
    ["src/layaAir/flash/filters/FilterRegistry.ts", "ConcreteBitmapFilter", "type"],
    ["src/layaAir/flash/filters/GlowFilter.ts", "GlowFilter", "class"],
    ["src/layaAir/flash/filters/GlowFilter.ts", "isGlowFilter", "function"],
    ["src/layaAir/flash/filters/GradientBevelFilter.ts", "GradientBevelFilter", "class"],
    ["src/layaAir/flash/filters/GradientBevelFilter.ts", "isGradientBevelFilter", "function"],
];
filterCapability.obligations = filterSubjects.map(([module, exported, kind]) =>
    filterCapability.obligations.find(item => item.module === module && item.export === exported)
    || { module, export: exported, kind, signature: "", ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" });

const renderingFilterCapability = ledger.capabilities.find(item => item.id === "rendering.filter");
Object.assign(renderingFilterCapability, {
    status: "native",
    artifacts: [
        {
            path: "src/layaAir/laya/display/effect2d/FlashFilterEffects.ts",
            export: "FlashBlurEffect2D",
            sha256: "",
        },
        {
            path: "src/layaAir/laya/display/effect2d/FlashBevelEffects.ts",
            export: "FlashBevelEffect2D",
            sha256: "",
        },
    ],
    evidence: [{
        path: "tests/architecture/flashFiltersBridgeEvidence.test.ts",
        test: "Flash filter bridge compiler surface and native effect ownership",
        sha256: "",
        capability: "rendering.filter",
        covers: [],
    }],
});
delete renderingFilterCapability.blockingReason;

let browserCapability = ledger.capabilities.find(item => item.id === "api.flash.browser");
if (!browserCapability) {
    browserCapability = { id: "api.flash.browser" };
    ledger.capabilities.push(browserCapability);
}
Object.assign(browserCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts", "FlashGlobalErrorBoundary", "class"],
        ["src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts", "FlashGlobalErrorLease", "interface"],
        ["src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts", "FlashGlobalErrorReceiver", "type"],
        ["src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts", "FlashGlobalErrorObservation", "type"],
        ["src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts", "FlashGlobalErrorReport", "interface"],
        ["src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts", "FlashGlobalErrorSource", "type"],
        ["src/layaAir/flash/browser/FlashGlobalErrorBoundary.ts", "FlashUnhandledRejectionReport", "interface"],
    ].map(([module, exported, kind]) => browserCapability.obligations?.find(
        item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashBrowserBridgeEvidence.test.ts",
        test: "Flash browser global-error compiler surface",
        sha256: "",
        capability: "api.flash.browser",
        covers: [],
    }],
});
delete browserCapability.blockingReason;

const ensureFlashCapability = (id, subjects, evidencePath, evidenceTest) => {
    let capability = ledger.capabilities.find(item => item.id === id);
    if (!capability) {
        capability = { id };
        ledger.capabilities.push(capability);
    }
    Object.assign(capability, {
        status: "typescript-obligation",
        obligations: subjects.map(([module, exported, kind]) => capability.obligations?.find(
            item => item.module === module && item.export === exported && item.kind === kind)
            || { module, export: exported, kind, signature: "",
                ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
        evidence: [{ path: evidencePath, test: evidenceTest, sha256: "", capability: id, covers: [] }],
    });
    delete capability.blockingReason;
};

ensureFlashCapability("api.flash.system", [
    ["src/layaAir/flash/system/ApplicationDomain.ts", "ApplicationDomain", "class"],
    ["src/layaAir/flash/system/Capabilities.ts", "Capabilities", "class"],
    ["src/layaAir/flash/system/ImageDecodingPolicy.ts", "ImageDecodingPolicy", "class"],
    ["src/layaAir/flash/system/LoaderContext.ts", "LoaderContext", "class"],
    ["src/layaAir/flash/system/Security.ts", "Security", "class"],
    ["src/layaAir/flash/system/System.ts", "System", "class"],
    ["src/layaAir/flash/system/System.ts", "NativeSystemHost", "interface"],
    ["src/layaAir/flash/system/System.ts", "NativeSystemHostLease", "class"],
    ["src/layaAir/flash/system/System.ts", "installNativeSystemHost", "function"],
], "tests/architecture/flashSystemHostBridgeEvidence.test.ts",
"Flash system bridge compiler surface and clean-break dispositions");

ensureFlashCapability("api.flash.media", [
    ["src/layaAir/flash/media/Sound.ts", "Sound", "class"],
    ["src/layaAir/flash/media/SoundChannel.ts", "SoundChannel", "class"],
    ["src/layaAir/flash/media/SoundLoaderContext.ts", "SoundLoaderContext", "class"],
    ["src/layaAir/flash/media/SoundTransform.ts", "SoundTransform", "class"],
], "tests/architecture/flashMediaBridgeEvidence.test.ts",
"Flash media bridge compiler surface");

ensureFlashCapability("api.flash.external", [
    ["src/layaAir/flash/external/ExternalInterface.ts", "ExternalInterface", "class"],
    ["src/layaAir/flash/external/ExternalInterface.ts", "ExternalInterfaceValue", "type"],
    ["src/layaAir/flash/external/ExternalInterface.ts", "NativeExternalInterfaceHost", "interface"],
    ["src/layaAir/flash/external/ExternalInterface.ts", "NativeExternalInterfaceHostLease", "class"],
    ["src/layaAir/flash/external/ExternalInterface.ts", "installNativeExternalInterfaceHost", "function"],
], "tests/architecture/flashSystemHostBridgeEvidence.test.ts",
"Flash external call-only bridge compiler surface");

ensureFlashCapability("api.flash.errors", [
    ["src/layaAir/flash/errors/IllegalOperationError.ts", "IllegalOperationError", "class"],
], "tests/architecture/flashSystemHostBridgeEvidence.test.ts",
"Flash native illegal-operation error compiler surface");

ensureFlashCapability("api.flash.debug", [
    ["src/layaAir/flash/debug/trace.ts", "trace", "function"],
], "tests/architecture/flashDebugBridgeEvidence.test.ts",
"Flash debug compiler surface");
const authoredBitmapHierarchySubjects = {
    normalize: ["src/extensions/authoredContent/core/NeutralAuthoredContentIR.ts", "normalizeNeutralAuthoredContent", "function"],
    parseXml: ["src/extensions/authoredContent/offlineAdapters/SwfXmlSourceAdapter.ts", "parseSwfAuthoredContentXml", "function"],
    prepareHierarchy: ["src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts", "prepareNativeLayaHierarchy", "function"],
    canonicalHierarchy: ["src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts", "canonicalLayaHierarchyBytes", "function"],
    prepareBundle: ["src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts", "prepareNativeLayaAuthoredContentBundle", "function"],
    writeTransaction: ["src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts", "writeNativeLayaAuthoredContentTransaction", "function"],
};
const admitAuthoredBitmapHierarchy = (id, keys) => {
    const capability = ledger.capabilities.find(item => item.id === id);
    if (!capability) throw new Error(`Missing authored-content capability ${id}`);
    Object.assign(capability, {
        status: "typescript-obligation",
        obligations: keys.map(key => {
            const [module, exported, kind] = authoredBitmapHierarchySubjects[key];
            return capability.obligations?.find(item => item.module === module && item.export === exported)
                || { module, export: exported, kind, signature: "", sha256: "" };
        }),
        evidence: [{
            path: "tests/architecture/authoredBitmapHierarchyEvidence.test.ts",
            test: "Authenticated bitmap hierarchy compiler surface",
            sha256: "",
            capability: id,
            covers: [],
        }],
    });
    delete capability.blockingReason;
};
admitAuthoredBitmapHierarchy("library.symbol-linkage", ["normalize", "prepareHierarchy"]);
admitAuthoredBitmapHierarchy("library.imported-assets", ["parseXml", "prepareBundle"]);
admitAuthoredBitmapHierarchy("display.hierarchy", ["normalize", "prepareHierarchy"]);
admitAuthoredBitmapHierarchy("display.instance-name", ["normalize", "prepareHierarchy"]);
admitAuthoredBitmapHierarchy("media.bitmap", ["parseXml", "prepareBundle"]);
admitAuthoredBitmapHierarchy("native.prefab", ["prepareHierarchy", "canonicalHierarchy", "prepareBundle", "writeTransaction"]);

const authoredButtonInteractionSubjects = {
    normalize: ["src/extensions/authoredContent/core/NeutralAuthoredContentIR.ts", "normalizeNeutralAuthoredContent", "function"],
    adapter: ["src/extensions/authoredContent/offlineAdapters/FlashLibrarySymbolAdapter.ts", "FlashLibrarySymbolAdapter", "class"],
    hierarchy: ["src/extensions/authoredContent/emit/NativeLayaHierarchyWriter.ts", "prepareNativeLayaHierarchy", "function"],
    runtimePrimitives: ["src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives.ts", "registerAuthoredContentPrimitives", "function"],
    authoredButtonPredicate: ["src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives.ts", "isAuthoredSimpleButton", "function"],
    flashButtonPredicate: ["src/layaAir/flash/display/SimpleButton.ts", "isFlashSimpleButton", "function"],
};
const admitAuthoredButtonInteraction = (id, keys) => {
    const capability = ledger.capabilities.find(item => item.id === id);
    if (!capability) throw new Error(`Missing authored-content capability ${id}`);
    Object.assign(capability, {
        status: "typescript-obligation",
        obligations: keys.map(key => {
            const [module, exported, kind] = authoredButtonInteractionSubjects[key];
            return capability.obligations?.find(item => item.module === module && item.export === exported)
                || { module, export: exported, kind, signature: "", sha256: "",
                    ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}) };
        }),
        evidence: [{
            path: "tests/architecture/authoredButtonInteractionEvidence.test.ts",
            test: "Authored Flash button interaction compiler surface",
            sha256: "",
            capability: id,
            covers: [],
        }],
    });
    delete capability.blockingReason;
};
admitAuthoredButtonInteraction("interaction.button-states", [
    "normalize", "adapter", "hierarchy", "runtimePrimitives",
]);
admitAuthoredButtonInteraction("interaction.hit-test", [
    "flashButtonPredicate",
]);
admitAuthoredButtonInteraction("interaction.pointer", [
    "authoredButtonPredicate",
]);

Object.assign(ledger.capabilities.find(item => item.id === "display.place-remove-depth"), {
    status: "blocking",
    blockingReason: "Authenticated static placement depth is supported, but frame-driven place and remove semantics are not implemented."
});
Object.assign(ledger.capabilities.find(item => item.id === "timeline.nested-symbol"), {
    status: "blocking",
    blockingReason: "Static nested symbol hierarchy is supported, but independently clocked nested timeline playback is not implemented."
});

if (!runtimeTypeAuthority.types.some(item => item.sourceQName === "flash.filters.GradientBevelFilter")) {
    runtimeTypeAuthority.types.push({
        sourceQName: "flash.filters.GradientBevelFilter",
        targetCapabilityId: "api.flash.filters",
        targetModule: "src/layaAir/flash/filters/GradientBevelFilter.ts",
        constructorExport: "GradientBevelFilter",
        constructorSignature: "",
        constructSignatures: [],
        predicateExport: "isGradientBevelFilter",
        predicateSignature: "",
        heritageClosure: [],
        moduleSha256: "",
    });
}

let xmlCapability = ledger.capabilities.find(item => item.id === "api.flash.xml");
if (!xmlCapability) {
    xmlCapability = { id: "api.flash.xml" };
    ledger.capabilities.push(xmlCapability);
}
Object.assign(xmlCapability, {
    status: "typescript-obligation",
    obligations: [
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlDocument", "class"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlLimits", "interface"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlDeclaration", "interface"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlAttribute", "interface"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlText", "interface"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlCData", "interface"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlComment", "interface"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlElement", "interface"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlNode", "type"],
        ["src/layaAir/flash/xml/StrictXmlDocument.ts", "StrictXmlDocumentNode", "type"],
        ["src/layaAir/flash/xml/XMLNode.ts", "XMLNode", "class"],
    ].map(([module, exported, kind]) => xmlCapability.obligations?.find(
        item => item.module === module && item.export === exported)
        || { module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashXmlBridgeEvidence.test.ts",
        test: "Strict immutable XML resource compiler surface",
        sha256: "",
        capability: "api.flash.xml",
        covers: [],
    }],
});
delete xmlCapability.blockingReason;

const options = compilerOptions();
const program = ts.createProgram({ rootNames: compilerRoots(), options });
const checker = program.getTypeChecker();

updateRuntimeTypeAuthority();

for (const capability of ledger.capabilities) {
    const admitted = [...(capability.artifacts || []), ...(capability.obligations || [])];
    for (const obligation of capability.obligations || []) updateSurface(obligation);
    for (const item of admitted)
        item.sha256 = canonicalHash(item.path || item.module);
    const coverage = [...new Set(admitted.map(item => item.sha256))].sort();
    for (const evidence of capability.evidence || []) {
        evidence.sha256 = canonicalHash(evidence.path);
        evidence.covers = coverage;
    }
}
const ledgerOutput = `${JSON.stringify(ledger, null, 2)}\n`;
const runtimeTypeAuthorityOutput = `${JSON.stringify(runtimeTypeAuthority, null, 2)}\n`;
const runtimeTypeAuthorityHashOutput =
    `${canonicalTextHash(runtimeTypeAuthorityOutput)}  flash-runtime-type-predicates.json\n`;
const outputs = [
    [ledgerPath, ledgerOutput],
    [runtimeTypeAuthorityPath, runtimeTypeAuthorityOutput],
    [runtimeTypeAuthorityHashPath, runtimeTypeAuthorityHashOutput],
];
if (process.argv.includes("--check")) {
    const drift = outputs.filter(([file, output]) => canonicalText(fs.readFileSync(file, "utf8")) !== canonicalText(output));
    if (drift.length > 0)
        throw new Error(`Authored-content generated output is stale: ${drift.map(([file]) => path.relative(root, file)).join(", ")}`);
    console.log("Authored-content hash output is canonical and idempotent.");
} else {
    for (const [file, output] of outputs) fs.writeFileSync(file, output);
    console.log("Updated authored-content hashes using canonical-lf-utf8.");
}

function canonicalHash(relative) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes repository: ${relative}`);
    const bytes = fs.readFileSync(file);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`Not valid UTF-8: ${relative}`);
    return canonicalTextHash(text);
}

function canonicalText(value) {
    return value.replace(/\r\n?/g, "\n");
}

function canonicalTextHash(value) {
    return crypto.createHash("sha256").update(canonicalText(value), "utf8").digest("hex");
}

function compilerOptions() {
    const fallback = {
        allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true,
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        baseUrl: path.join(root, "src/layaAir"),
    };
    for (const relative of ["tsconfig.json", "src/extensions/tsconfig.json", "src/layaAir/tsconfig.json"]) {
        const file = path.join(root, relative);
        if (!fs.existsSync(file)) continue;
        const loaded = ts.readConfigFile(file, ts.sys.readFile);
        if (loaded.error) throw new Error(`Cannot parse ${relative}`);
        const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(file));
        return { ...fallback, ...parsed.options, allowJs: true, checkJs: false, noEmit: true };
    }
    return fallback;
}

function compilerRoots() {
    const relative = new Set(runtimeTypeAuthority.types.map(entry => entry.targetModule));
    for (const capability of ledger.capabilities) {
        for (const obligation of capability.obligations || []) relative.add(obligation.module);
    }
    return [...relative].sort().map(file => path.join(root, file));
}

function updateSurface(obligation) {
    const source = program.getSourceFile(path.join(root, obligation.module));
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find(symbol => symbol.name === obligation.export);
    if (!exported) throw new Error(`Missing export ${obligation.export} from ${obligation.module}`);
    const declaration = exported.valueDeclaration || exported.declarations?.find(item => !item.getSourceFile().isDeclarationFile);
    if (!declaration) throw new Error(`Missing concrete declaration ${obligation.export}`);
    obligation.signature = logicalCompilerSignature(root, checker.typeToString(
        checker.getTypeOfSymbolAtLocation(exported, declaration), declaration, ts.TypeFormatFlags.NoTruncation));
    if (!ts.isClassDeclaration(declaration)) return;
    const instanceType = checker.getDeclaredTypeOfSymbol(exported);
    const classType = checker.getTypeOfSymbolAtLocation(exported, declaration);
    obligation.heritage = (declaration.heritageClauses || []).flatMap(clause => clause.types.map(type => ({
        kind: clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements",
        signature: logicalCompilerSignature(root, checker.typeToString(
            checker.getTypeAtLocation(type), type, ts.TypeFormatFlags.NoTruncation)),
    }))).sort((a, b) => `${a.kind}:${a.signature}`.localeCompare(`${b.kind}:${b.signature}`));
    const collect = (type, scope) => checker.getPropertiesOfType(type).filter(member => {
        if (scope === "static" && member.name === "prototype") return false;
        const memberDeclaration = member.valueDeclaration || member.declarations?.[0];
        const modifiers = memberDeclaration ? ts.getModifiers(memberDeclaration) || [] : [];
        return !modifiers.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
    }).map(member => {
        const memberDeclaration = member.valueDeclaration || member.declarations?.[0] || declaration;
        const modifiers = ts.getModifiers(memberDeclaration) || [];
        const declarationKinds = (member.declarations || []).map(item => ts.SyntaxKind[item.kind]);
        const accessorKinds = [declarationKinds.includes("GetAccessor") ? "get" : null,
            declarationKinds.includes("SetAccessor") ? "set" : null].filter(Boolean);
        let signature = logicalCompilerSignature(root, checker.typeToString(
            checker.getTypeOfSymbolAtLocation(member, memberDeclaration), memberDeclaration, ts.TypeFormatFlags.NoTruncation));
        const localAccessors = declaration.members.filter(item =>
            (ts.isGetAccessorDeclaration(item) || ts.isSetAccessorDeclaration(item))
            && item.name.getText() === member.name);
        const getterDeclaration = localAccessors.find(ts.isGetAccessorDeclaration)
            || member.declarations?.find(ts.isGetAccessorDeclaration);
        const setterDeclaration = localAccessors.find(ts.isSetAccessorDeclaration)
            || member.declarations?.find(ts.isSetAccessorDeclaration);
        if (getterDeclaration && setterDeclaration && setterDeclaration.parameters.length === 1) {
            const getterCall = checker.getSignatureFromDeclaration(getterDeclaration);
            const getterType = getterCall && checker.getReturnTypeOfSignature(getterCall);
            const setterType = checker.getTypeAtLocation(setterDeclaration.parameters[0]);
            const getterSignature = getterDeclaration.type
                ? logicalCompilerSignature(root, getterDeclaration.type.getText())
                : getterType && logicalCompilerSignature(root,
                    checker.typeToString(getterType, getterDeclaration, ts.TypeFormatFlags.NoTruncation));
            const setterSignature = setterDeclaration.parameters[0].type
                ? logicalCompilerSignature(root, setterDeclaration.parameters[0].type.getText())
                : logicalCompilerSignature(root,
                    checker.typeToString(setterType, setterDeclaration, ts.TypeFormatFlags.NoTruncation));
            if (getterSignature && getterSignature !== setterSignature)
                signature = `get ${getterSignature}; set ${setterSignature}`;
        }
        return {
            abstract: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword),
            kind: accessorKinds.length ? accessorKinds.join("+")
                : ts.isMethodDeclaration(memberDeclaration) || ts.isMethodSignature(memberDeclaration) ? "method" : "property",
            name: member.name, scope,
            optional: Boolean(member.flags & ts.SymbolFlags.Optional || memberDeclaration.questionToken),
            readonly: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
            signature,
        };
    });
    obligation.members = [...collect(instanceType, "instance"), ...collect(classType, "static")]
        .sort((a, b) => `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`));
    const classModifiers = ts.getModifiers(declaration) || [];
    const declaredConstructors = declaration.members.filter(ts.isConstructorDeclaration);
    const isNonConstructibleClass = classModifiers.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword)
        || declaredConstructors.some(constructor => (ts.getModifiers(constructor) || []).some(modifier =>
            modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword));
    obligation.constructors = isNonConstructibleClass ? [] : classType.getConstructSignatures().map(signature => logicalCompilerSignature(root,
        checker.signatureToString(signature, declaration, ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Construct))).sort();
    obligation.indexSignatures = [["number", instanceType.getNumberIndexType()], ["string", instanceType.getStringIndexType()]]
        .filter(([, type]) => Boolean(type)).map(([key, type]) => ({
            key, signature: logicalCompilerSignature(root, checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation))
        }));
}

function updateRuntimeTypeAuthority() {
    if (runtimeTypeAuthority.schema !== "laya-flash-runtime-type-predicates@1"
        || runtimeTypeAuthority.hashMode !== "canonical-lf-utf8"
        || !Array.isArray(runtimeTypeAuthority.types))
        throw new Error("Flash runtime type authority has the wrong schema");

    const resolved = runtimeTypeAuthority.types.map(entry => {
        const source = program.getSourceFile(path.join(root, entry.targetModule));
        const moduleSymbol = source && checker.getSymbolAtLocation(source);
        const exports = moduleSymbol && checker.getExportsOfModule(moduleSymbol);
        const constructorSymbol = exports?.find(symbol => symbol.name === entry.constructorExport);
        const predicateSymbol = exports?.find(symbol => symbol.name === entry.predicateExport);
        const constructorDeclaration = constructorSymbol?.valueDeclaration;
        const predicateDeclaration = predicateSymbol?.valueDeclaration;
        if (!constructorSymbol || !constructorDeclaration || !ts.isClassDeclaration(constructorDeclaration)
            || !predicateSymbol || !predicateDeclaration || !ts.isFunctionDeclaration(predicateDeclaration))
            throw new Error(`Missing exact runtime type exports for ${entry.sourceQName}`);
        return { entry, constructorSymbol, constructorDeclaration, predicateSymbol, predicateDeclaration };
    });
    const qnameBySymbol = new Map(resolved.map(item => [item.constructorSymbol, item.entry.sourceQName]));
    const byQName = new Map(resolved.map(item => [item.entry.sourceQName, item]));
    const closure = (qname, seen = new Set()) => {
        if (seen.has(qname)) throw new Error(`Cyclic Flash runtime heritage at ${qname}`);
        seen.add(qname);
        const item = byQName.get(qname);
        const baseTypes = checker.getDeclaredTypeOfSymbol(item.constructorSymbol).getBaseTypes() || [];
        const direct = baseTypes.map(type => qnameBySymbol.get(type.getSymbol())).filter(Boolean);
        if (direct.length > 1) throw new Error(`Ambiguous Flash runtime heritage at ${qname}`);
        return direct.length === 0 ? [] : [direct[0], ...closure(direct[0], seen)];
    };

    for (const item of resolved) {
        const classType = checker.getTypeOfSymbolAtLocation(item.constructorSymbol, item.constructorDeclaration);
        item.entry.constructorSignature = logicalCompilerSignature(root, checker.typeToString(
            classType, item.constructorDeclaration, ts.TypeFormatFlags.NoTruncation));
        item.entry.constructSignatures = classType.getConstructSignatures().map(signature => logicalCompilerSignature(root,
            checker.signatureToString(signature, item.constructorDeclaration,
                ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Construct))).sort();
        item.entry.predicateSignature = logicalCompilerSignature(root, checker.typeToString(
            checker.getTypeOfSymbolAtLocation(item.predicateSymbol, item.predicateDeclaration),
            item.predicateDeclaration, ts.TypeFormatFlags.NoTruncation));
        item.entry.heritageClosure = closure(item.entry.sourceQName);
        item.entry.moduleSha256 = canonicalHash(item.entry.targetModule);
    }
    runtimeTypeAuthority.types.sort((left, right) => left.sourceQName.localeCompare(right.sourceQName));
}
