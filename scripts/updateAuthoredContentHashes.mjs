import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { logicalCompilerSignature } from "./checkAuthoredContentAdmission.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ledgerPath = path.join(root, "docTool/architecture/authored-content-capabilities.json");
const runtimeTypeAuthorityRelative = "docTool/architecture/flash-runtime-type-predicates.json";
const runtimeTypeAuthorityPath = path.join(root, runtimeTypeAuthorityRelative);
const runtimeTypeAuthorityHashPath = path.join(root, "docTool/architecture/flash-runtime-type-predicates.sha256");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const runtimeTypeAuthority = JSON.parse(fs.readFileSync(runtimeTypeAuthorityPath, "utf8"));
if (ledger.hashMode !== "canonical-lf-utf8")
    throw new Error("Capability ledger must declare hashMode canonical-lf-utf8");

const eventCapability = ledger.capabilities.find(item => item.id === "api.flash.events");
for (const [module, exported, kind = "class"] of [
    ["src/layaAir/flash/events/FocusEvent.ts", "FocusEvent"],
    ["src/layaAir/flash/events/IMEEvent.ts", "IMEEvent"],
    ["src/layaAir/flash/events/TextEvent.ts", "TextEvent"],
    ["src/layaAir/flash/events/ErrorEvent.ts", "isFlashErrorEvent", "function"],
    ["src/layaAir/flash/events/Event.ts", "isFlashEvent", "function"],
    ["src/layaAir/flash/events/EventDispatcher.ts", "IEventDispatcher", "interface"],
    ["src/layaAir/flash/events/EventDispatcher.ts", "isFlashEventDispatcher", "function"],
    ["src/layaAir/flash/events/FlashEventRouter.ts", "FlashEventListener", "type"],
    ["src/layaAir/flash/events/FlashEventRouter.ts", "NativeEventHost", "interface"],
    ["src/layaAir/flash/events/FocusEvent.ts", "isFlashFocusEvent", "function"],
    ["src/layaAir/flash/events/IOErrorEvent.ts", "isFlashIOErrorEvent", "function"],
    ["src/layaAir/flash/events/KeyboardEvent.ts", "isFlashKeyboardEvent", "function"],
    ["src/layaAir/flash/events/MouseEvent.ts", "isFlashMouseEvent", "function"],
    ["src/layaAir/flash/events/TextEvent.ts", "isFlashTextEvent", "function"],
    ["src/layaAir/flash/events/TimerEvent.ts", "isFlashTimerEvent", "function"],
]) {
    if (!eventCapability.obligations.some(item => item.module === module && item.export === exported))
        eventCapability.obligations.push({ module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" });
}

const displayCapability = ledger.capabilities.find(item => item.id === "api.flash.display");
for (const [module, exported, kind = "class"] of [
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
    ["src/layaAir/flash/display/Graphics.ts", "isFlashGraphics", "function"],
    ["src/layaAir/flash/display/IBitmapDrawable.ts", "IBitmapDrawable", "type"],
    ["src/layaAir/flash/display/InteractiveObject.ts", "isFlashInteractiveObject", "function"],
    ["src/layaAir/flash/display/InteractiveObject.ts", "resolveFlashFocusOwner", "function"],
    ["src/layaAir/flash/display/MovieClip.ts", "FlashFrameReference", "type"],
    ["src/layaAir/flash/display/MovieClip.ts", "isFlashMovieClip", "function"],
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
for (const [module, exported] of textSubjects) {
    if (!textCapability.obligations.some(item => item.module === module && item.export === exported))
        textCapability.obligations.push({ module, export: exported, kind: exported.startsWith("flash") || exported.startsWith("isFlash") ? "function" : "class", signature: "", members: [], constructors: [], indexSignatures: [], sha256: "" });
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

const geometryCapability = ledger.capabilities.find(item => item.id === "api.flash.geom");
for (const [module, exported, kind = "class"] of [
    ["src/layaAir/flash/geom/Point.ts", "Point"],
    ["src/layaAir/flash/geom/Rectangle.ts", "Rectangle"],
    ["src/layaAir/flash/geom/Point.ts", "isFlashPoint", "function"],
    ["src/layaAir/flash/geom/Rectangle.ts", "isFlashRectangle", "function"],
]) {
    if (!geometryCapability.obligations.some(item => item.module === module && item.export === exported))
        geometryCapability.obligations.push({ module, export: exported, kind, signature: "",
            ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" });
}

const netCapability = ledger.capabilities.find(item => item.id === "api.flash.net");
const netSubjects = [
    ["src/layaAir/flash/net/URLRequest.ts", "URLRequest", "class"],
    ["src/layaAir/flash/net/URLRequest.ts", "navigateToURL", "function"],
    ["src/layaAir/flash/net/URLRequest.ts", "URLRequestHeader", "interface"],
    ["src/layaAir/flash/net/URLRequest.ts", "isFlashURLRequest", "function"],
    ["src/layaAir/flash/net/URLLoaderDataFormat.ts", "URLLoaderDataFormat", "class"],
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
        ["src/layaAir/flash/utils/Endian.ts", "Endian", "class"],
        ["src/layaAir/flash/utils/ByteArray.ts", "ByteArray", "class"],
        ["src/layaAir/flash/utils/ByteArray.ts", "ByteArrayInput", "type"],
        ["src/layaAir/flash/utils/ByteArray.ts", "ZlibDecompressionHost", "interface"],
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
    obligations: [["src/layaAir/flash/ui/MouseCursor.ts", "MouseCursor", "class"]].map(
        ([module, exported, kind]) => uiCapability.obligations?.find(
            item => item.module === module && item.export === exported)
            || { module, export: exported, kind, signature: "", members: [], constructors: [], indexSignatures: [], sha256: "" }),
    evidence: [{
        path: "tests/architecture/flashConstantsBridgeEvidence.test.ts",
        test: "Flash string constant compiler and runtime surface",
        sha256: "",
        capability: "api.flash.ui",
        covers: [],
    }],
});
delete uiCapability.blockingReason;

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
];
filterCapability.obligations = filterSubjects.map(([module, exported, kind]) =>
    filterCapability.obligations.find(item => item.module === module && item.export === exported)
    || { module, export: exported, kind, signature: "", ...(kind === "class" ? { members: [], constructors: [], indexSignatures: [] } : {}), sha256: "" });

const renderingFilterCapability = ledger.capabilities.find(item => item.id === "rendering.filter");
Object.assign(renderingFilterCapability, {
    status: "native",
    artifacts: [{
        path: "src/layaAir/laya/display/effect2d/FlashFilterEffects.ts",
        export: "FlashBlurEffect2D",
        sha256: "",
    }],
    evidence: [{
        path: "tests/architecture/flashFiltersBridgeEvidence.test.ts",
        test: "Flash filter bridge compiler surface and native effect ownership",
        sha256: "",
        capability: "rendering.filter",
        covers: [],
    }],
});
delete renderingFilterCapability.blockingReason;

const options = compilerOptions();
const program = ts.createProgram({ rootNames: discoverCode(root), options });
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

function discoverCode(directory) {
    const skip = new Set([".git", "node_modules", "build", "bin", "coverage", ".idea", ".vscode"]);
    const extensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
    const result = [];
    const visit = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isDirectory() && skip.has(entry.name)) continue;
            const candidate = path.join(current, entry.name);
            if (entry.isDirectory()) visit(candidate);
            else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(candidate);
        }
    };
    visit(directory);
    return result;
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
