import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let ts;
try {
    ts = require("typescript");
} catch (error) {
    throw new Error("The authored-content admission guard requires the repository TypeScript dependency.", { cause: error });
}

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const POLICY_FILE = "scripts/authoredContentAdmission.policy.json";
const ROOT_PACKAGE = "package.json";
const BUILD_CONFIG = "scripts/config.mjs";
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "pluginDependencies"];
const PACKAGE_TARGET_FIELDS = ["exports", "imports", "main", "module", "browser", "bin", "types", "typings", "typesVersions", "files", "sideEffects"];
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "build", "bin", "coverage", ".idea", ".vscode"]);
const ADAPTER_SOURCE_TOKENS = new Set(["flash", "swf", "xfl"]);
const EXECUTABLE_SOURCE_TOKENS = new Set(["abc", "avm", "avm2"]);
const BRIDGE_MACHINERY_TOKENS = new Set(["abc", "avm", "avm2", "qname", "cinit", "admission"]);
const IMPLEMENTATION_TOKENS = new Set(["reader", "loader", "parser", "deserializer", "decoder", "interpreter", "facade", "adapter", "resolver", "registry"]);
const COMPATIBILITY_TOKENS = new Set(["legacy", "compat", "compatibility", "fallback", "alias", "aliases", "dual"]);
const DECLARATIVE_EXTENSIONS = new Set([".lh", ".ls", ".mc", ".mcc", ".json"]);
const REQUIRED_POLICY_CAPABILITIES = new Set(`
document.stage-metadata library.symbol-linkage library.imported-assets
display.hierarchy display.place-remove-depth display.instance-name
geometry.shape-path geometry.gradient-fill geometry.bitmap-fill geometry.morph
media.bitmap media.font media.audio media.video media.binary
text.static-glyph-runs text.dynamic text.input text.html-layout text.advanced-rasterization text.authored-device-field-configuration text.authored-static-text-texture-foundation
interaction.button-states interaction.hit-test interaction.pointer interaction.focus-tab
rendering.transform rendering.color-transform rendering.mask rendering.blend rendering.filter rendering.cache rendering.scaling-grid
timeline.frames-labels timeline.property-track timeline.nested-symbol timeline.morph-ratio timeline.audio timeline.declarative-cue
binding.event binding.typed-handler localization.text localization.media localization.layout
identity.persistent patch.semantic reimport.three-way
native.prefab native.scene native.animation-clip native.animation-controller publish.atlas source.executable-code
api.flash.display api.flash.events api.flash.geom api.flash.text api.flash.net api.flash.utils api.flash.filters api.flash.ui
`.trim().split(/\s+/));
const REQUIRED_POLICY_VALUES = Object.freeze({
    schema: "laya-authored-content-admission-policy@1",
    runtimeRoot: "src/layaAir/laya/authoredContent",
    runtimeCoreRoot: "src/layaAir/laya/authoredContent/core",
    runtimeAdapterRoot: "src/layaAir/laya/authoredContent/layaair",
    editorRoot: "src/extensions/authoredContent",
    offlineAdapterRoot: "src/extensions/authoredContent/offlineAdapters",
    flashApiBridgeRoot: "src/layaAir/flash",
    capabilityLedger: "docTool/architecture/authored-content-capabilities.json",
    capabilitySchema: "laya-authored-content-capabilities@1",
    runtimeIdentity: "Laya.AuthoredTimelineClip",
    currentDocumentSchema: "neutral-authored-content@1",
});
const REQUIRED_FLASH_NAMESPACES = ["flash.display", "flash.events", "flash.geom", "flash.text", "flash.net", "flash.utils", "flash.filters", "flash.ui"];
const REQUIRED_STATUSES = ["native", "declarative", "typescript-obligation", "evidence", "blocking"];
const BITMAP_FILTER_BASE = "src/layaAir/flash/filters/BitmapFilter.ts";
const ADMITTED_BITMAP_FILTER_SUBCLASSES = new Set([
    "src/layaAir/flash/filters/BlurFilter.ts",
    "src/layaAir/flash/filters/ColorMatrixFilter.ts",
    "src/layaAir/flash/filters/DropShadowFilter.ts",
    "src/layaAir/flash/filters/GlowFilter.ts",
]);

function normalize(value) {
    return value.replaceAll("\\", "/");
}

function relative(root, absolute) {
    return normalize(path.relative(root, absolute));
}

function absolute(root, file) {
    return path.resolve(root, ...normalize(file).split("/"));
}

function isWithin(file, directory) {
    return file === directory || file.startsWith(`${directory}/`);
}

function discover(root, start = "") {
    const base = absolute(root, start || ".");
    if (!fs.existsSync(base))
        return [];
    const result = [];
    const visit = directory => {
        const entries = fs.readdirSync(directory, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name))
                continue;
            const candidate = path.join(directory, entry.name);
            if (entry.isDirectory())
                visit(candidate);
            else if (entry.isFile())
                result.push(relative(root, candidate));
        }
    };
    visit(base);
    return result;
}

function readJson(root, file, failures) {
    try {
        return JSON.parse(fs.readFileSync(absolute(root, file), "utf8"));
    } catch (error) {
        failures.push(`${file}: must contain valid JSON (${error.message})`);
        return null;
    }
}

function realContainedPath(root, declared, label, failures) {
    if (typeof declared !== "string" || declared.length === 0) {
        failures.push(`${label}: must be a non-empty repository-relative path`);
        return null;
    }
    const candidate = absolute(root, declared);
    const rootPrefix = `${path.resolve(root)}${path.sep}`.toLowerCase();
    if (candidate.toLowerCase() !== path.resolve(root).toLowerCase()
        && !candidate.toLowerCase().startsWith(rootPrefix)) {
        failures.push(`${label}: path escapes the repository (${declared})`);
        return null;
    }
    if (!fs.existsSync(candidate)) {
        failures.push(`${label}: referenced path does not exist (${declared})`);
        return null;
    }
    const real = fs.realpathSync.native(candidate);
    const realRoot = fs.realpathSync.native(root);
    const realPrefix = `${realRoot}${path.sep}`.toLowerCase();
    if (real.toLowerCase() !== realRoot.toLowerCase() && !real.toLowerCase().startsWith(realPrefix)) {
        failures.push(`${label}: referenced path resolves outside the repository (${declared})`);
        return null;
    }
    return relative(root, real);
}

function roleForFile(file, policy) {
    if (isWithin(file, policy.flashApiBridgeRoot))
        return "flash-api";
    if (isWithin(file, policy.runtimeCoreRoot))
        return "core";
    if (isWithin(file, policy.runtimeAdapterRoot))
        return "layaair";
    if (isWithin(file, policy.runtimeRoot))
        return "runtime";
    if (isWithin(file, policy.offlineAdapterRoot))
        return "offline-adapter";
    if (isWithin(file, policy.editorRoot))
        return "editor";
    if (isWithin(file, "src/layaAir"))
        return "production";
    return "other";
}

function reverseDependency(owner, target) {
    return owner === "core" && (target === "layaair" || target === "runtime" || target === "editor" || target === "offline-adapter" || target === "flash-api")
        || (owner === "layaair" || owner === "runtime") && target === "flash-api"
        || (owner === "layaair" || owner === "runtime" || owner === "production")
            && (target === "editor" || target === "offline-adapter")
        || owner === "flash-api" && (target === "core" || target === "layaair" || target === "runtime"
            || target === "editor" || target === "offline-adapter");
}

function tokens(value) {
    return String(value)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function compatibilityImplementation(value) {
    const parts = tokens(value);
    return parts.some(part => COMPATIBILITY_TOKENS.has(part))
        && parts.some(part => IMPLEMENTATION_TOKENS.has(part));
}

function sourceTokens(value) {
    const parts = tokens(value);
    return {
        adapter: parts.filter(part => ADAPTER_SOURCE_TOKENS.has(part)),
        executable: parts.filter(part => EXECUTABLE_SOURCE_TOKENS.has(part)),
    };
}

function hasAuthoredSourceSurface(value) {
    const found = sourceTokens(value).adapter;
    if (found.some(token => token === "swf" || token === "xfl"))
        return true;
    const parts = tokens(value);
    return found.includes("flash") && parts.some(token => IMPLEMENTATION_TOKENS.has(token));
}

function hasBridgeMachinery(value) {
    const parts = tokens(value);
    if (parts.some(part => BRIDGE_MACHINERY_TOKENS.has(part)))
        return true;
    const compact = parts.join("");
    return compact.includes("qname") || compact.includes("cinit")
        || parts.some(part => part === "trait" || part === "traits")
            && parts.some(part => ["avm", "class", "instance", "method", "slot", "script", "callable"].includes(part));
}

function hasAvmSemanticMachinery(value) {
    const parts = tokens(value);
    const compact = parts.join("");
    const publicQualifiedNameApi = compact === "getqualifiedclassname" || compact === "getqualifiedsuperclassname";
    return hasBridgeMachinery(value)
        || parts.includes("multiname")
        || parts.includes("bytecode") && parts.some(part => part === "interpreter" || part === "executor")
        || !publicQualifiedNameApi && parts.includes("qualified") && parts.includes("name")
        || parts.includes("trait") && parts.some(part => ["class", "instance", "method", "slot", "script", "callable"].includes(part));
}

function classLikeName(node) {
    if (ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name))
        return node.parent.name.text;
    if (node.name)
        return node.name.text;
    return "";
}

function isAuthoredReaderName(name) {
    const parts = tokens(name);
    const implementation = parts.some(part => ["read", "reader", "parse", "parser", "load", "loader", "deserialize", "deserializer", "decode", "decoder"].includes(part));
    const authored = parts.some(part => ["movie", "timeline", "symbol", "document", "authored"].includes(part))
        || parts.includes("legacy") && parts.includes("asset");
    return implementation && authored;
}

const CAPABILITY_HASH_MODE = "canonical-lf-utf8";

function canonicalCapabilityBytes(root, file) {
    const bytes = fs.readFileSync(absolute(root, file));
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes))
        throw new Error(`${file}: ${CAPABILITY_HASH_MODE} requires valid UTF-8 source bytes`);
    return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
}

function sha256(root, file) {
    return crypto.createHash("sha256").update(canonicalCapabilityBytes(root, file)).digest("hex");
}

export function logicalCompilerSignature(root, value) {
    const repository = normalize(path.resolve(root)).replace(/\/$/, "");
    const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return value.replace(/\\/g, "/")
        .replace(new RegExp(escaped, "gi"), "repo:")
        .replace(/\s+/g, " ")
        .trim();
}

function compilerOptions(root, failures) {
    const fallback = {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        baseUrl: absolute(root, "src/layaAir"),
    };
    for (const candidate of ["tsconfig.json", "src/extensions/tsconfig.json", "src/layaAir/tsconfig.json"]) {
        if (!fs.existsSync(absolute(root, candidate)))
            continue;
        const loaded = ts.readConfigFile(absolute(root, candidate), ts.sys.readFile);
        if (loaded.error) {
            failures.push(`${candidate}: TypeScript configuration cannot be parsed`);
            continue;
        }
        const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(absolute(root, candidate)));
        return { ...fallback, ...parsed.options, allowJs: true, checkJs: false, noEmit: true };
    }
    return fallback;
}

function scriptKind(file) {
    switch (path.extname(file).toLowerCase()) {
        case ".tsx": return ts.ScriptKind.TSX;
        case ".jsx": return ts.ScriptKind.JSX;
        case ".js": case ".mjs": case ".cjs": return ts.ScriptKind.JS;
        default: return ts.ScriptKind.TS;
    }
}

function sourceProgram(root, files, options) {
    const roots = files.filter(file => CODE_EXTENSIONS.has(path.extname(file).toLowerCase())).map(file => absolute(root, file));
    return ts.createProgram({ rootNames: roots, options });
}

function literalText(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
        || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression?.(node)))
        node = node.expression;
    return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function canonicalSymbol(checker, node) {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
    return symbol || null;
}

function symbolKey(symbol) {
    if (!symbol)
        return null;
    return symbol.declarations?.map(declaration => `${normalize(declaration.getSourceFile().fileName)}:${declaration.pos}`).sort().join("|") || null;
}

function localSymbolKey(checker, node) {
    return symbolKey(checker.getSymbolAtLocation(node));
}

function isLocallyDeclared(checker, identifier) {
    const symbol = canonicalSymbol(checker, identifier);
    return Boolean(symbol?.declarations?.some(declaration => !declaration.getSourceFile().isDeclarationFile));
}

function collectModuleReferences(sourceFile, checker, governed, failures, file) {
    const references = [];
    const requireAliases = new Set();
    const createRequireFactories = new Set();
    const add = (argument, kind) => {
        const specifier = literalText(argument);
        if (specifier === null) {
            if (governed)
                failures.push(`${file}: ${kind} must use a direct string literal`);
            return;
        }
        references.push({ specifier, kind });
    };
    const firstPass = node => {
        if (ts.isImportDeclaration(node) && literalText(node.moduleSpecifier) === "node:module"
            && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings))
            for (const element of node.importClause.namedBindings.elements)
                if ((element.propertyName || element.name).text === "createRequire")
                    createRequireFactories.add(localSymbolKey(checker, element.name));
        if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer)
            for (const element of node.name.elements)
                if (ts.isIdentifier(element.name) && (element.propertyName || element.name).getText(sourceFile).replace(/["']/g, "") === "createRequire")
                    createRequireFactories.add(localSymbolKey(checker, element.name));
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            if (ts.isIdentifier(node.initializer) && node.initializer.text === "require" && !isLocallyDeclared(checker, node.initializer))
                requireAliases.add(symbolKey(canonicalSymbol(checker, node.name)));
            if (ts.isIdentifier(node.initializer) && createRequireFactories.has(localSymbolKey(checker, node.initializer)))
                createRequireFactories.add(localSymbolKey(checker, node.name));
            if (ts.isPropertyAccessExpression(node.initializer) && node.initializer.name.text === "createRequire")
                createRequireFactories.add(localSymbolKey(checker, node.name));
            if (ts.isElementAccessExpression(node.initializer) && literalText(node.initializer.argumentExpression) === "createRequire")
                createRequireFactories.add(localSymbolKey(checker, node.name));
            if (ts.isCallExpression(node.initializer) && ts.isPropertyAccessExpression(node.initializer.expression)
                && node.initializer.expression.name.text === "bind") {
                const base = node.initializer.expression.expression;
                const direct = ts.isIdentifier(base) && base.text === "require" && !isLocallyDeclared(checker, base);
                const aliased = ts.isIdentifier(base) && requireAliases.has(symbolKey(canonicalSymbol(checker, base)));
                if (direct || aliased)
                    requireAliases.add(symbolKey(canonicalSymbol(checker, node.name)));
            }
            if (ts.isCallExpression(node.initializer)
                && (ts.isIdentifier(node.initializer.expression)
                    && (node.initializer.expression.text === "createRequire"
                        || createRequireFactories.has(localSymbolKey(checker, node.initializer.expression)))
                    || ts.isPropertyAccessExpression(node.initializer.expression) && node.initializer.expression.name.text === "createRequire"
                    || ts.isElementAccessExpression(node.initializer.expression)
                        && literalText(node.initializer.expression.argumentExpression) === "createRequire"))
                requireAliases.add(symbolKey(canonicalSymbol(checker, node.name)));
        }
        ts.forEachChild(node, firstPass);
    };
    firstPass(sourceFile);
    const visit = node => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier)
            add(node.moduleSpecifier, "import");
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
            add(node.moduleSpecifier, "export-from");
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
            add(node.moduleReference.expression, "import-equals");
        else if (ts.isCallExpression(node)) {
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
                add(node.arguments[0], "dynamic import");
            else if (ts.isIdentifier(node.expression)) {
                const directGlobalRequire = node.expression.text === "require" && !isLocallyDeclared(checker, node.expression);
                const aliasedRequire = requireAliases.has(symbolKey(canonicalSymbol(checker, node.expression)));
                if (directGlobalRequire || aliasedRequire)
                    add(node.arguments[0], aliasedRequire ? "aliased require" : "require");
            } else if (ts.isPropertyAccessExpression(node.expression)
                && ts.isIdentifier(node.expression.expression)
                && node.expression.expression.text === "require"
                && node.expression.name.text === "resolve"
                && !isLocallyDeclared(checker, node.expression.expression)) {
                add(node.arguments[0], "require.resolve");
            } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "require") {
                add(node.arguments[0], "module.require");
            } else if (ts.isPropertyAccessExpression(node.expression)
                && (node.expression.name.text === "call" || node.expression.name.text === "apply")
                && !(ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Reflect")) {
                const base = node.expression.expression;
                const direct = ts.isIdentifier(base) && base.text === "require" && !isLocallyDeclared(checker, base);
                const aliased = ts.isIdentifier(base) && requireAliases.has(symbolKey(canonicalSymbol(checker, base)));
                if (direct || aliased) {
                    if (node.expression.name.text === "call")
                        add(node.arguments[1], "require.call");
                    else if (ts.isArrayLiteralExpression(node.arguments[1]) && node.arguments[1].elements.length > 0)
                        add(node.arguments[1].elements[0], "require.apply");
                    else if (governed)
                        failures.push(`${file}: require.apply arguments must be a direct literal array`);
                }
            } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
                && node.expression.expression.text === "Reflect" && node.expression.name.text === "apply"
                && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === "require"
                && !isLocallyDeclared(checker, node.arguments[0])) {
                const argumentsArray = node.arguments[2];
                if (ts.isArrayLiteralExpression(argumentsArray) && argumentsArray.elements.length > 0)
                    add(argumentsArray.elements[0], "Reflect.apply(require)");
                else if (governed)
                    failures.push(`${file}: Reflect.apply(require) arguments must be a direct literal array`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return references;
}

function resolveReference(root, file, specifier, options, policy) {
    const containing = absolute(root, file);
    const resolved = ts.resolveModuleName(specifier, containing, options, ts.sys).resolvedModule;
    if (resolved) {
        const result = relative(root, resolved.resolvedFileName);
        if (!result.startsWith("../") && result !== "..")
            return result;
    }
    if (specifier.startsWith(".")) {
        const base = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
        for (const suffix of ["", ".ts", ".tsx", ".js", "/index.ts", "/index.js"])
            if (fs.existsSync(absolute(root, `${base}${suffix}`)))
                return `${base}${suffix}`;
    }
    if (specifier === "laya/authoredContent" || specifier.startsWith("laya/authoredContent/"))
        return specifier.replace(/^laya\//, "src/layaAir/laya/");
    if (specifier === "laya.authoredContent")
        return policy.editorRoot;
    return null;
}

function inspectCode(root, files, program, options, policy, failures) {
    const checker = program.getTypeChecker();
    for (const diagnostic of program.getSyntacticDiagnostics()) {
        if (!diagnostic.file)
            continue;
        const file = relative(root, diagnostic.file.fileName);
        const role = roleForFile(file, policy);
        if (role === "core" || role === "layaair" || role === "runtime" || role === "editor"
            || role === "offline-adapter" || role === "flash-api") {
            const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start || 0);
            failures.push(`${file}:${position.line + 1}:${position.character + 1}: TypeScript syntax error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
        }
    }
    const graph = new Map();
    const runtimeSources = [];
    const registrationCalls = [];
    const identityDeclarations = [];
    const timelineClasses = [];
    const readerClasses = [];
    const schemaIds = new Set();
    let canonicalIdentityLiteralCount = 0;
    const alternateRuntimeIdentities = [];

    for (const sourceFile of program.getSourceFiles()) {
        const file = relative(root, sourceFile.fileName);
        if (file.startsWith("../") || file.includes("/node_modules/") || !files.includes(file))
            continue;
        const role = roleForFile(file, policy);
        const governed = role === "core" || role === "layaair" || role === "runtime" || role === "editor"
            || role === "offline-adapter" || role === "flash-api";
        if (role === "core" || role === "layaair" || role === "runtime")
            runtimeSources.push(sourceFile);
        const references = collectModuleReferences(sourceFile, checker, governed, failures, file);
        const edges = [];
        for (const reference of references) {
            const resolved = resolveReference(root, file, reference.specifier, options, policy);
            if (resolved) {
                edges.push(resolved);
                const targetRole = roleForFile(resolved, policy);
                if (reverseDependency(role, targetRole))
                    failures.push(`${file}: ${role} ${reference.kind} reaches ${targetRole} module ${reference.specifier}`);
            } else if (governed && (reference.specifier.startsWith(".") || reference.specifier.includes("authored"))) {
                failures.push(`${file}: governed ${reference.kind} cannot be resolved (${reference.specifier})`);
            }
        }
        graph.set(file, edges);

        if (governed) {
            const fileSource = sourceTokens(file);
            if (fileSource.executable.length > 0)
                failures.push(`${file}: executable source-format code is forbidden`);
            if (hasAuthoredSourceSurface(file) && role !== "offline-adapter" && role !== "flash-api")
                failures.push(`${file}: source-format adapters must live under ${policy.offlineAdapterRoot}`);
            if (compatibilityImplementation(file))
                failures.push(`${file}: compatibility, fallback, alias, legacy, and dual implementations are forbidden`);
        }

        const visit = node => {
            if (governed && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
                const value = node.text;
                const found = sourceTokens(value);
                if (found.executable.length > 0)
                    failures.push(`${file}: executable source-format symbol or value is forbidden (${value})`);
                if ((role === "core" || role === "layaair" || role === "runtime") && hasAvmSemanticMachinery(value))
                    failures.push(`${file}: authored runtime may not contain AVM/QName/trait/bytecode machinery (${value})`);
                // The editor entrypoint is allowed to select and invoke an offline adapter.
                // Implementations remain confined to offlineAdapterRoot, and production
                // reachability checks keep both the editor and its adapters out of bundles.
                if (hasAuthoredSourceSurface(value) && role !== "offline-adapter" && role !== "editor" && role !== "flash-api")
                    failures.push(`${file}: source-format symbol or value is outside the editor-only adapter lane (${value})`);
                if (role === "flash-api" && hasAvmSemanticMachinery(value))
                    failures.push(`${file}: Flash API bridge may not contain ABC/AVM/QName/cinit/admission/trait machinery (${value})`);
                if (role === "flash-api" && found.adapter.some(token => token === "swf" || token === "xfl"))
                    failures.push(`${file}: Flash API bridge may not contain authored-asset readers or loaders (${value})`);
                if (role === "flash-api" && isAuthoredReaderName(value))
                    failures.push(`${file}: Flash API bridge may not contain legacy authored reader/decoder surface (${value})`);
                if (compatibilityImplementation(value))
                    failures.push(`${file}: forbidden clean-break implementation surface (${value})`);
                if (typeof value === "string" && /^neutral-authored-content@\d+$/.test(value))
                    schemaIds.add(value);
                if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
                    if (value === policy.runtimeIdentity)
                        canonicalIdentityLiteralCount += 1;
                    else if (/^Laya\..*Authored.*Timeline|^Laya\..*Timeline.*Authored/i.test(value))
                        alternateRuntimeIdentities.push(`${file}: ${value}`);
                }
            }
            if (governed && ts.isCallExpression(node)) {
                const expression = node.expression;
                const calledName = ts.isIdentifier(expression) ? expression.text
                    : ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
                if ((calledName === "eval" || calledName === "Function") && role !== "offline-adapter")
                    failures.push(`${file}: runtime code generation is forbidden in authored-content code`);
                if ((calledName === "regClass" || calledName === "registerClass") && role !== "editor" && role !== "offline-adapter") {
                    const argumentValues = node.arguments.map(literalText);
                    const argumentNames = node.arguments.map(argument => ts.isIdentifier(argument) ? argument.text : "");
                    if (argumentValues.includes(policy.runtimeIdentity)
                        || argumentValues.some(value => value && /Authored.*Timeline|Timeline.*Authored/i.test(value))
                        || argumentNames.includes("AUTHORED_TIMELINE_CLIP_CLASS_ID")
                        || argumentNames.includes("AuthoredTimelineClip")) {
                        registrationCalls.push({ node, sourceFile, file });
                    }
                }
            }
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
                && node.name.text === "AUTHORED_TIMELINE_CLIP_CLASS_ID") {
                const statement = node.parent?.parent;
                const exported = statement && ts.isVariableStatement(statement)
                    && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
                const isConst = Boolean(node.parent.flags & ts.NodeFlags.Const);
                if (!exported || !isConst || literalText(node.initializer) !== policy.runtimeIdentity)
                    failures.push(`${file}: AUTHORED_TIMELINE_CLIP_CLASS_ID must be one exported const initialized to ${policy.runtimeIdentity}`);
                identityDeclarations.push(node);
            }
            if (ts.isClassDeclaration(node) && node.name?.text === "AuthoredTimelineClip")
                timelineClasses.push(node);
            if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
                const declaredName = classLikeName(node);
                const classTokens = tokens(declaredName);
                const methodNames = node.members.filter(ts.isMethodDeclaration).map(member => member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : "");
                const implementsSourceAdapter = node.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ImplementsKeyword
                    && clause.types.some(type => /(?:^|\.)SourceAdapter$/.test(type.expression.getText(sourceFile)))) || false;
                if (implementsSourceAdapter && role !== "offline-adapter")
                    failures.push(`${file}: SourceAdapter implementations must live under ${policy.offlineAdapterRoot}`);
                if ((role === "core" || role === "layaair" || role === "runtime")
                    && (isAuthoredReaderName(declaredName)
                        || classTokens.some(token => ["reader", "loader", "parser", "deserializer", "decoder"].includes(token)))
                    && methodNames.some(name => ["read", "load", "parse", "decode", "deserialize"].includes(name)))
                    readerClasses.push({ node, file });
                if (role === "flash-api" && isAuthoredReaderName(declaredName))
                    failures.push(`${file}: Flash API bridge may not contain authored-asset reader/parser class ${declaredName}`);
                if (role === "flash-api" && classTokens.includes("trait"))
                    failures.push(`${file}: Flash API bridge may not declare AVM-style trait class ${declaredName}`);
                const extendsBitmapFilter = node.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ExtendsKeyword
                    && clause.types.some(type => {
                        let symbol = checker.getSymbolAtLocation(type.expression);
                        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
                        return symbol?.declarations?.some(declaration => normalize(path.relative(root, declaration.getSourceFile().fileName)) === BITMAP_FILTER_BASE);
                    })) || false;
                if (extendsBitmapFilter && !ADMITTED_BITMAP_FILTER_SUBCLASSES.has(file))
                    failures.push(`${file}: BitmapFilter is a closed Flash value base and may only be extended by admitted native filter classes`);
            }
            if (ts.isExportSpecifier(node) && node.propertyName && node.propertyName.text !== node.name.text
                && (tokens(node.propertyName.text).includes("authored") || tokens(node.name.text).includes("authored")))
                failures.push(`${file}: authored runtime exports may not create aliases (${node.propertyName.text} as ${node.name.text})`);
            if ((role === "core" || role === "layaair" || role === "runtime") && ts.isBinaryExpression(node)
                && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
                const calls = [];
                const collectCalls = child => {
                    if (ts.isCallExpression(child)) {
                        const name = ts.isIdentifier(child.expression) ? child.expression.text
                            : ts.isPropertyAccessExpression(child.expression) ? child.expression.name.text : "";
                        if (tokens(name).some(token => ["read", "load", "parse", "decode", "deserialize"].includes(token)))
                            calls.push(name);
                    }
                    ts.forEachChild(child, collectCalls);
                };
                collectCalls(node);
                if (calls.length > 1)
                    failures.push(`${file}: reader/loader fallback chains are forbidden`);
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }

    if (schemaIds.size > 1 || [...schemaIds].some(schema => schema !== policy.currentDocumentSchema))
        failures.push(`authored runtime: exactly one current document schema is allowed (${[...schemaIds].sort().join(", ")})`);
    if (readerClasses.length > 1)
        failures.push(`authored runtime: multiple reader/loader implementations are forbidden (${readerClasses.map(item => item.file).join(", ")})`);

    if (runtimeSources.length > 0) {
        if (identityDeclarations.length !== 1)
            failures.push(`authored runtime: expected exactly one AUTHORED_TIMELINE_CLIP_CLASS_ID declaration, found ${identityDeclarations.length}`);
        if (timelineClasses.length !== 1)
            failures.push(`authored runtime: expected exactly one AuthoredTimelineClip class, found ${timelineClasses.length}`);
        if (registrationCalls.length !== 1)
            failures.push(`authored runtime: expected exactly one canonical class registration, found ${registrationCalls.length}`);
        if (canonicalIdentityLiteralCount !== 1)
            failures.push(`authored runtime: canonical identity literal must occur exactly once, found ${canonicalIdentityLiteralCount}`);
        if (alternateRuntimeIdentities.length > 0)
            failures.push(`authored runtime: alternate runtime identities are forbidden (${alternateRuntimeIdentities.sort().join(", ")})`);
    }
    if (identityDeclarations.length === 1 && timelineClasses.length === 1 && registrationCalls.length === 1) {
        const registration = registrationCalls[0];
        const call = registration.node;
        const callee = call.expression;
        const direct = ts.isPropertyAccessExpression(callee)
            && ts.isIdentifier(callee.expression)
            && callee.expression.text === "ClassUtils"
            && callee.name.text === "regClass";
        if (!direct || call.arguments.length !== 2)
            failures.push(`${registration.file}: canonical registration must directly call ClassUtils.regClass with exactly two arguments`);
        else {
            const calleeSymbol = canonicalSymbol(checker, callee.name);
            const calleeFiles = calleeSymbol?.declarations?.map(declaration => relative(root, declaration.getSourceFile().fileName)) || [];
            if (!calleeFiles.some(file => /src\/layaAir\/laya\/utils\/ClassUtils\.ts$/i.test(file)))
                failures.push(`${registration.file}: registration callee does not resolve to engine ClassUtils.regClass`);
            if (symbolKey(canonicalSymbol(checker, call.arguments[0])) !== symbolKey(canonicalSymbol(checker, identityDeclarations[0].name)))
                failures.push(`${registration.file}: registration ID does not resolve to the canonical identity declaration`);
            if (symbolKey(canonicalSymbol(checker, call.arguments[1])) !== symbolKey(canonicalSymbol(checker, timelineClasses[0].name)))
                failures.push(`${registration.file}: registration constructor does not resolve to AuthoredTimelineClip`);
        }
    }
    return { checker, graph, program, options, policy, runtimeSourceCount: runtimeSources.length };
}

function inspectFlashNamespaces(files, policy, requiredIds, failures) {
    const namespaces = policy.flashApiNamespaces;
    if (!Array.isArray(namespaces) || new Set(namespaces).size !== namespaces.length) {
        failures.push(`${POLICY_FILE}: flashApiNamespaces must be a unique array`);
        return;
    }
    for (const namespace of REQUIRED_FLASH_NAMESPACES)
        if (!namespaces.includes(namespace))
            failures.push(`${POLICY_FILE}: flashApiNamespaces may not omit ${namespace}`);
    for (const namespace of namespaces) {
        if (typeof namespace !== "string" || !/^flash\.[A-Za-z][A-Za-z0-9-]*$/.test(namespace)) {
            failures.push(`${POLICY_FILE}: invalid Flash API namespace ${JSON.stringify(namespace)}`);
            continue;
        }
        const capability = `api.${namespace}`;
        if (!requiredIds.has(capability))
            failures.push(`${POLICY_FILE}: Flash API namespace ${namespace} requires capability ${capability}`);
    }
    for (const file of files.filter(candidate => isWithin(candidate, policy.flashApiBridgeRoot))) {
        if (!CODE_EXTENSIONS.has(path.extname(file).toLowerCase()))
            continue;
        const local = file.slice(policy.flashApiBridgeRoot.length + 1);
        if (!local.includes("/") && /^(?:index|ModuleDef)\.[cm]?[jt]sx?$/i.test(local))
            continue;
        const segment = local.split("/")[0].replace(/\.[^.]+$/, "");
        const namespace = `flash.${segment}`;
        if (!namespaces.includes(namespace))
            failures.push(`${file}: undeclared Flash API namespace ${namespace} requires a policy capability before shipping`);
    }
}

function jsonStrings(value, callback, trail = []) {
    if (typeof value === "string")
        callback(value, trail);
    else if (Array.isArray(value))
        value.forEach((item, index) => jsonStrings(item, callback, [...trail, String(index)]));
    else if (value && typeof value === "object")
        Object.entries(value).forEach(([key, item]) => {
            callback(key, [...trail, key], true);
            jsonStrings(item, callback, [...trail, key]);
        });
}

function inspectJsonDocuments(root, files, policy, requiredIds, failures, syntheticBlockingCapabilities) {
    const jsonFiles = files.filter(file => file.endsWith(".json")
        && (isWithin(file, policy.runtimeRoot) || isWithin(file, policy.editorRoot) || isWithin(file, policy.flashApiBridgeRoot)
            || /authored.*(?:schema|manifest)|(?:schema|manifest).*authored/i.test(path.posix.basename(file))));
    for (const file of jsonFiles) {
        const document = readJson(root, file, failures);
        if (document === null)
            continue;
        const role = roleForFile(file, policy);
        jsonStrings(document, (value, trail, isKey = false) => {
            const found = sourceTokens(value);
            if (found.executable.length > 0)
                failures.push(`${file}: executable source-format ${isKey ? "key" : "value"} is forbidden at ${trail.join(".")}`);
            if (hasAuthoredSourceSurface(value) && role !== "offline-adapter" && role !== "flash-api")
                failures.push(`${file}: source-format JSON is outside the editor-only adapter lane at ${trail.join(".")}`);
            if (compatibilityImplementation(value))
                failures.push(`${file}: compatibility/fallback/legacy implementation JSON is forbidden at ${trail.join(".")}`);
        });
        if (role === "core" || role === "layaair" || role === "runtime") {
            if (typeof document.schema === "string" && document.schema !== policy.currentDocumentSchema)
                failures.push(`${file}: runtime manifest schema must be ${policy.currentDocumentSchema}`);
        }
        if (file.endsWith(".schema.json")) {
            const discriminator = document?.properties?.schema?.const;
            if (discriminator !== undefined && discriminator !== policy.currentDocumentSchema)
                failures.push(`${file}: schema discriminator must be the single current identity ${policy.currentDocumentSchema}`);
            jsonStrings(document, (value, trail) => {
                if (trail.at(-1) !== "$ref")
                    return;
                if (/^[a-z]+:/i.test(value) || value.startsWith("/") || normalize(value).split("/").includes(".."))
                    failures.push(`${file}: schema reference must stay local (${value})`);
            });
        }
        discoverParameters(document, file, requiredIds, failures, syntheticBlockingCapabilities);
    }
}

function slug(value) {
    return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function discoverParameters(value, file, requiredIds, failures, syntheticBlockingCapabilities, trail = []) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => discoverParameters(item, file, requiredIds, failures, syntheticBlockingCapabilities, [...trail, String(index)]));
        return;
    }
    if (!value || typeof value !== "object")
        return;
    for (const [key, child] of Object.entries(value)) {
        if ((key === "discoveredTags" || key === "discoveredParameters") && Array.isArray(child)) {
            const kind = key === "discoveredTags" ? "tag" : "parameter";
            for (const item of child) {
                const label = typeof item === "string" ? item : item?.name;
                const capabilityId = typeof item === "object" && item ? item.capabilityId : null;
                if (typeof capabilityId !== "string" || !requiredIds.has(capabilityId)) {
                    const synthetic = `source.${kind}.${slug(label)}`;
                    syntheticBlockingCapabilities.add(synthetic);
                    failures.push(`${file}: unknown discovered ${kind} '${label ?? "unknown"}' requires blocking capability ${synthetic}`);
                }
            }
        }
        discoverParameters(child, file, requiredIds, failures, syntheticBlockingCapabilities, [...trail, key]);
    }
}

function inspectPackages(root, files, policy, failures) {
    const packageFiles = files.filter(file => path.posix.basename(file) === "package.json");
    const packages = [];
    const names = new Map();
    for (const file of packageFiles) {
        const document = readJson(root, file, failures);
        if (!document)
            continue;
        const role = roleForFile(file, policy);
        packages.push({ file, document, role });
        if (typeof document.name === "string")
            names.set(document.name, role);
    }
    const productionTargets = [];
    for (const { file, document, role } of packages) {
        for (const field of DEPENDENCY_FIELDS) {
            const dependencies = document[field];
            if (dependencies === undefined)
                continue;
            if (!dependencies || Array.isArray(dependencies) || typeof dependencies !== "object") {
                failures.push(`${file}: ${field} must be an object`);
                continue;
            }
            for (const [dependency, version] of Object.entries(dependencies)) {
                let target = names.get(dependency);
                if (!target && typeof version === "string" && version.startsWith("npm:")) {
                    const alias = version.slice(4);
                    const packageName = alias.startsWith("@")
                        ? alias.slice(0, alias.indexOf("@", 1) < 0 ? alias.length : alias.indexOf("@", 1))
                        : alias.split("@")[0];
                    target = names.get(packageName);
                }
                if (!target && typeof version === "string" && version.startsWith("workspace:")
                    && !/^[.]/.test(version.slice("workspace:".length))) {
                    const workspaceAlias = version.slice("workspace:".length).replace(/@(?:\^|~|\*|[0-9].*)$/, "");
                    target = names.get(workspaceAlias);
                }
                if (!target && typeof version === "string" && /^(?:file|link|portal):/.test(version)
                    || !target && typeof version === "string" && /^workspace:\.?\.?[\\/]/.test(version)) {
                    const linkedSpecifier = normalize(version.replace(/^(?:file|link|portal|workspace):/, ""));
                    const linked = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), linkedSpecifier)));
                    const linkedPackage = linked.endsWith("package.json") ? linked : `${linked}/package.json`;
                    if (files.includes(linkedPackage))
                        target = roleForFile(linkedPackage, policy);
                }
                if (target && reverseDependency(role, target))
                    failures.push(`${file}: ${role} package may not depend on ${target} package ${dependency} through ${field}`);
            }
        }
        for (const field of PACKAGE_TARGET_FIELDS) {
            if (document[field] === undefined)
                continue;
            jsonStrings(document[field], value => {
                if (!value.startsWith("."))
                    return;
                const target = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), value)));
                const targetRole = roleForFile(target, policy);
                if (reverseDependency(role, targetRole))
                    failures.push(`${file}: ${field} exposes reverse-layer target ${value}`);
                if (file === ROOT_PACKAGE && field !== "files" && field !== "sideEffects") {
                    const extension = path.posix.extname(target);
                    const targetPatterns = [target];
                    if ([".js", ".mjs", ".cjs"].includes(extension))
                        targetPatterns.push(...[".ts", ".tsx", ".mts", ".cts"].map(sourceExtension => target.slice(0, -extension.length) + sourceExtension));
                    const matchers = targetPatterns.map(pattern => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`));
                    const matches = files.filter(candidate => matchers.some(matcher => matcher.test(candidate)));
                    if (matches.length > 0)
                        productionTargets.push(...matches);
                    else {
                        const bases = extension === ".js" || extension === ".mjs" || extension === ".cjs"
                            ? [target.slice(0, -extension.length)] : [target];
                        for (const base of bases)
                            for (const suffix of ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.mts", "/index.cts", "/index.js", "/index.mjs", "/index.cjs"])
                                if (files.includes(`${base}${suffix}`))
                                    productionTargets.push(`${base}${suffix}`);
                    }
                }
            });
        }
    }
    return [...new Set(productionTargets)];
}

function inspectCapabilityLedger(root, policy, code, failures) {
    const ledger = readJson(root, policy.capabilityLedger, failures);
    const requiredIds = new Set(policy.requiredCapabilities);
    const statuses = new Set(policy.statuses);
    const blockingIds = [];
    const evidenceFiles = new Set();
    const bridgeOwnership = new Map();
    if (!ledger)
        return { blockingIds, requiredIds, evidenceFiles, bridgeOwnership };
    if (ledger.schema !== policy.capabilitySchema)
        failures.push(`${policy.capabilityLedger}: schema must be ${policy.capabilitySchema}`);
    if (ledger.runtimeIdentity !== policy.runtimeIdentity)
        failures.push(`${policy.capabilityLedger}: runtimeIdentity must be ${policy.runtimeIdentity}`);
    if (ledger.documentSchema !== policy.currentDocumentSchema)
        failures.push(`${policy.capabilityLedger}: documentSchema must be ${policy.currentDocumentSchema}`);
    if (policy.capabilityHashMode !== CAPABILITY_HASH_MODE || ledger.hashMode !== CAPABILITY_HASH_MODE)
        failures.push(`${policy.capabilityLedger}: hashMode must be ${CAPABILITY_HASH_MODE}`);
    if (Object.hasOwn(ledger, "productionReady"))
        failures.push(`${policy.capabilityLedger}: productionReady is derived and must not be asserted in the ledger`);
    if (!Array.isArray(ledger.capabilities)) {
        failures.push(`${policy.capabilityLedger}: capabilities must be an array`);
        return { blockingIds, requiredIds, evidenceFiles, bridgeOwnership };
    }
    const seen = new Set();
    for (const capability of ledger.capabilities) {
        const id = capability?.id;
        if (typeof id !== "string" || !requiredIds.has(id)) {
            failures.push(`${policy.capabilityLedger}: unknown capability ${JSON.stringify(id)}`);
            continue;
        }
        if (seen.has(id)) {
            failures.push(`${policy.capabilityLedger}: duplicate capability ${id}`);
            continue;
        }
        seen.add(id);
        if (!statuses.has(capability.status)) {
            failures.push(`${policy.capabilityLedger}: ${id} has invalid status ${JSON.stringify(capability.status)}`);
            continue;
        }
        if (id === "source.executable-code" && (capability.status === "native" || capability.status === "declarative"))
            failures.push(`${policy.capabilityLedger}: source.executable-code may not be admitted as ${capability.status}`);
        if (id.startsWith("api.flash.")
            && capability.status !== "blocking" && capability.status !== "typescript-obligation")
            failures.push(`${policy.capabilityLedger}: ${id} requires a TypeScript obligation with an exact public API surface`);
        if (capability.status === "blocking") {
            blockingIds.push(id);
            if (typeof capability.blockingReason !== "string" || capability.blockingReason.trim().length < 12)
                failures.push(`${policy.capabilityLedger}: blocking capability ${id} requires a concrete blockingReason`);
            continue;
        }
        const evidence = inspectEvidence(root, capability.evidence, `${id}.evidence`, id, code, failures);
        if (evidence.length === 0)
            failures.push(`${policy.capabilityLedger}: admitted capability ${id} requires evidence`);
        for (const item of evidence)
            evidenceFiles.add(item.file);
        const coveredHashes = [];
        const expectedSubjects = [];
        if (capability.status === "native" || capability.status === "declarative") {
            const artifacts = inspectHashedPaths(root, capability.artifacts, `${id}.artifacts`, failures);
            coveredHashes.push(...(capability.artifacts || []).map(item => item?.sha256).filter(hash => typeof hash === "string"));
            for (const artifact of capability.artifacts || []) {
                if (!artifact || typeof artifact.path !== "string" || !CODE_EXTENSIONS.has(path.extname(artifact.path).toLowerCase()))
                    continue;
                if (typeof artifact.export !== "string" || artifact.export.length === 0)
                    failures.push(`${policy.capabilityLedger}: code artifact ${artifact.path} for ${id} requires an exported evidence subject`);
                else
                    expectedSubjects.push({ module: normalize(artifact.path), export: artifact.export });
            }
            if (artifacts.length === 0)
                failures.push(`${policy.capabilityLedger}: ${capability.status} capability ${id} requires artifacts`);
            if (capability.status === "native" && artifacts.some(file => !isWithin(file, "src/layaAir")))
                failures.push(`${policy.capabilityLedger}: native capability ${id} artifacts must be engine-owned`);
            if (id.startsWith("api.flash.") && artifacts.some(file => !isWithin(file, policy.flashApiBridgeRoot)))
                failures.push(`${policy.capabilityLedger}: ${id} artifacts must live under ${policy.flashApiBridgeRoot}`);
            if (capability.status === "declarative" && artifacts.some(file => !DECLARATIVE_EXTENSIONS.has(path.extname(file).toLowerCase())))
                failures.push(`${policy.capabilityLedger}: declarative capability ${id} has a non-declarative artifact`);
        } else if (capability.status === "typescript-obligation") {
            if (!Array.isArray(capability.obligations) || capability.obligations.length === 0) {
                failures.push(`${policy.capabilityLedger}: typescript-obligation capability ${id} requires obligations`);
            } else {
                for (const [index, obligation] of capability.obligations.entries()) {
                    if (typeof obligation?.sha256 === "string")
                        coveredHashes.push(obligation.sha256);
                    if (typeof obligation?.module === "string" && typeof obligation?.export === "string")
                        expectedSubjects.push({ module: normalize(obligation.module), export: obligation.export });
                    if (id.startsWith("api.flash.") && typeof obligation?.module === "string") {
                        const namespace = id.slice("api.flash.".length);
                        const moduleFile = normalize(obligation.module);
                        const namespaceRoot = `${policy.flashApiBridgeRoot}/${namespace}`;
                        if (!isWithin(moduleFile, namespaceRoot) && moduleFile !== `${namespaceRoot}.ts`)
                            failures.push(`${policy.capabilityLedger}: ${id} may only own modules in Flash namespace ${namespace}`);
                        if (!bridgeOwnership.has(id))
                            bridgeOwnership.set(id, new Map());
                        const modules = bridgeOwnership.get(id);
                        if (!modules.has(moduleFile))
                            modules.set(moduleFile, new Set());
                        modules.get(moduleFile).add(obligation.export);
                    }
                    inspectObligation(root, obligation, `${id}.obligations[${index}]`, code, failures,
                        id.startsWith("api.flash.") ? policy.flashApiBridgeRoot : null);
                }
            }
        }
        const expectedCoverage = [...new Set(coveredHashes)].sort();
        for (const [index, item] of evidence.entries()) {
            if (!Array.isArray(item.covers) || item.covers.some(hash => typeof hash !== "string")
                || JSON.stringify(item.covers) !== JSON.stringify(expectedCoverage))
                failures.push(`${id}.evidence[${index}].covers: must be sorted, unique, and exactly bind the admitted artifact/obligation hashes`);
            for (const subject of expectedSubjects) {
                const imported = item.analysis?.subjectImports.find(candidate => candidate.module === subject.module && candidate.export === subject.export);
                if (!imported || !item.analysis.usedKeys.has(imported.key))
                    failures.push(`${id}.evidence[${index}]: assertion must import and exercise ${subject.export} from ${subject.module}`);
            }
        }
    }
    for (const id of requiredIds)
        if (!seen.has(id))
            failures.push(`${policy.capabilityLedger}: missing required capability ${id}`);
    return { blockingIds, requiredIds, evidenceFiles, bridgeOwnership };
}

function inspectHashedPaths(root, value, label, failures) {
    if (!Array.isArray(value)) {
        failures.push(`${label}: must be an array`);
        return [];
    }
    const result = [];
    for (const [index, item] of value.entries()) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            failures.push(`${label}[${index}]: must be a hash-bound artifact object`);
            continue;
        }
        const file = realContainedPath(root, item.path, `${label}[${index}].path`, failures);
        if (!file)
            continue;
        inspectHash(root, file, item.sha256, `${label}[${index}].sha256`, failures);
        result.push(file);
    }
    return result;
}

function inspectHash(root, file, declaredHash, label, failures) {
    if (typeof declaredHash !== "string" || !/^[a-f0-9]{64}$/.test(declaredHash)) {
        failures.push(`${label}: must be a lowercase SHA-256 digest`);
        return;
    }
    const actual = sha256(root, file);
    if (actual !== declaredHash)
        failures.push(`${label}: hash drift for ${file} (expected ${declaredHash}, actual ${actual})`);
}

function analyzeNamedNodeTest(root, file, name, code) {
    if (!CODE_EXTENSIONS.has(path.extname(file).toLowerCase()))
        return null;
    const source = code.program.getSourceFile(absolute(root, file));
    if (!source)
        return null;
    const checker = code.checker;
    const testBindings = new Set();
    const assertionBindings = new Set();
    const assertionNamespaces = new Set();
    const subjectImports = [];
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement))
            continue;
        const moduleName = literalText(statement.moduleSpecifier);
        const clause = statement.importClause;
        if (moduleName === "node:test") {
            if (clause?.name)
                testBindings.add(localSymbolKey(checker, clause.name));
            if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
                for (const element of clause.namedBindings.elements)
                    if ((element.propertyName || element.name).text === "test" || (element.propertyName || element.name).text === "it")
                    testBindings.add(localSymbolKey(checker, element.name));
        }
        if (moduleName === "node:assert" || moduleName === "node:assert/strict") {
            if (clause?.name)
                assertionNamespaces.add(localSymbolKey(checker, clause.name));
            if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
                assertionNamespaces.add(localSymbolKey(checker, clause.namedBindings.name));
            if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
                for (const element of clause.namedBindings.elements)
                    assertionBindings.add(localSymbolKey(checker, element.name));
        }
        if (moduleName && moduleName.startsWith(".")) {
            const resolved = resolveReference(root, file, moduleName, code.options, code.policy);
            if (resolved && clause?.name)
                subjectImports.push({ module: resolved, export: "default", key: localSymbolKey(checker, clause.name) });
            if (resolved && clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
                for (const element of clause.namedBindings.elements)
                    subjectImports.push({
                        module: resolved,
                        export: (element.propertyName || element.name).text,
                        key: localSymbolKey(checker, element.name),
                    });
        }
    }
    const directAssertion = callback => {
        if (!ts.isBlock(callback.body))
            return null;
        const [statement] = callback.body.statements;
        if (callback.body.statements.length !== 1 || !statement
            || !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))
            return null;
            const expression = statement.expression.expression;
            const direct = ts.isIdentifier(expression) && assertionBindings.has(localSymbolKey(checker, expression));
            const namespaced = ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
                && assertionNamespaces.has(localSymbolKey(checker, expression.expression));
            if (direct || namespaced)
                return statement.expression;
        return null;
    };
    let analysis = null;
    const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && testBindings.has(localSymbolKey(checker, node.expression))
            && literalText(node.arguments[0]) === name && node.arguments.length === 2
            && (ts.isArrowFunction(node.arguments[1]) || ts.isFunctionExpression(node.arguments[1]))
            && ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent)) {
            const assertion = directAssertion(node.arguments[1]);
            if (assertion) {
                const usedKeys = new Set();
                const collect = child => {
                    if (ts.isIdentifier(child))
                        usedKeys.add(localSymbolKey(checker, child));
                    if (ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isFunctionDeclaration(child))
                        return;
                    if (ts.isBinaryExpression(child)
                        && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(child.operatorToken.kind)) {
                        collect(child.left);
                        return;
                    }
                    if (ts.isConditionalExpression(child)) {
                        collect(child.condition);
                        return;
                    }
                    ts.forEachChild(child, collect);
                };
                if (assertion.arguments[0])
                    collect(assertion.arguments[0]);
                analysis = { subjectImports, usedKeys };
            }
        }
        if (!analysis)
            ts.forEachChild(node, visit);
    };
    visit(source);
    return analysis;
}

function inspectEvidence(root, value, label, capabilityId, code, failures) {
    if (!Array.isArray(value)) {
        failures.push(`${label}: must be an array`);
        return [];
    }
    const valid = [];
    for (const [index, item] of value.entries()) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            failures.push(`${label}[${index}]: must be an evidence object`);
            continue;
        }
        const file = realContainedPath(root, item.path, `${label}[${index}].path`, failures);
        if (!file)
            continue;
        inspectHash(root, file, item.sha256, `${label}[${index}].sha256`, failures);
        if (item.capability !== capabilityId)
            failures.push(`${label}[${index}].capability: must bind proof to ${capabilityId}`);
        if (typeof item.test !== "string" || item.test.trim().length === 0)
            failures.push(`${label}[${index}].test: must be a non-empty test name`);
        const analysis = typeof item.test === "string" ? analyzeNamedNodeTest(root, file, item.test, code) : null;
        if (typeof item.test === "string" && !analysis)
            failures.push(`${label}[${index}].test: executable named node:test case '${item.test}' with an assertion does not exist in ${file}`);
        valid.push({ file, covers: item.covers, analysis });
    }
    return valid;
}

function inspectObligation(root, obligation, label, code, failures, requiredRoot = null) {
    if (!obligation || typeof obligation !== "object" || Array.isArray(obligation)) {
        failures.push(`${label}: must be an object`);
        return;
    }
    const moduleFile = realContainedPath(root, obligation.module, `${label}.module`, failures);
    if (!moduleFile || !CODE_EXTENSIONS.has(path.extname(moduleFile).toLowerCase())) {
        failures.push(`${label}.module: must reference TypeScript/JavaScript source`);
        return;
    }
    if (requiredRoot && !isWithin(moduleFile, requiredRoot))
        failures.push(`${label}.module: must live under ${requiredRoot}`);
    if (typeof obligation.export !== "string" || obligation.export.length === 0) {
        failures.push(`${label}.export: must name an exported symbol`);
        return;
    }
    const source = code.program.getSourceFile(absolute(root, moduleFile));
    const moduleSymbol = source && code.checker.getSymbolAtLocation(source);
    const exports = moduleSymbol ? code.checker.getExportsOfModule(moduleSymbol) : [];
    const exported = exports.find(symbol => symbol.name === obligation.export);
    if (!exported) {
        failures.push(`${label}: export ${obligation.export} does not resolve from ${moduleFile}`);
        return;
    }
    inspectHash(root, moduleFile, obligation.sha256, `${label}.sha256`, failures);
    const declaration = exported.valueDeclaration || exported.declarations?.find(item => !item.getSourceFile().isDeclarationFile);
    if (!declaration || declaration.getSourceFile().isDeclarationFile) {
        failures.push(`${label}: export ${obligation.export} must resolve to a repository declaration`);
        return;
    }
    const actualKind = ts.isFunctionDeclaration(declaration) ? "function"
        : ts.isClassDeclaration(declaration) ? "class"
            : ts.isInterfaceDeclaration(declaration) ? "interface"
                : ts.isTypeAliasDeclaration(declaration) ? "type"
            : ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const ? "const" : "other";
    if (!new Set(["function", "class", "const", "interface", "type"]).has(obligation.kind) || obligation.kind !== actualKind)
        failures.push(`${label}.kind: expected exact ${actualKind} export`);
    const actualSignature = logicalCompilerSignature(root, code.checker.typeToString(
        code.checker.getTypeOfSymbolAtLocation(exported, declaration),
        declaration,
        ts.TypeFormatFlags.NoTruncation,
    ));
    if (typeof obligation.signature !== "string" || logicalCompilerSignature(root, obligation.signature) !== actualSignature)
        failures.push(`${label}.signature: expected exact compiler signature ${JSON.stringify(actualSignature)}`);
    if (actualKind === "class") {
        const instanceType = code.checker.getDeclaredTypeOfSymbol(exported);
        const classType = code.checker.getTypeOfSymbolAtLocation(exported, declaration);
        const actualHeritage = (declaration.heritageClauses || []).flatMap(clause => clause.types.map(type => ({
            kind: clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements",
            signature: logicalCompilerSignature(root, code.checker.typeToString(
                code.checker.getTypeAtLocation(type), type, ts.TypeFormatFlags.NoTruncation)),
        }))).sort((a, b) => `${a.kind}:${a.signature}`.localeCompare(`${b.kind}:${b.signature}`));
        const declaredHeritage = Array.isArray(obligation.heritage) ? obligation.heritage.map(item => ({
            kind: item?.kind,
            signature: typeof item?.signature === "string"
                ? logicalCompilerSignature(root, item.signature) : item?.signature,
        })).sort((a, b) => `${a.kind}:${a.signature}`.localeCompare(`${b.kind}:${b.signature}`))
            : actualHeritage.length === 0 ? [] : null;
        const collectMembers = (type, scope) => code.checker.getPropertiesOfType(type).filter(member => {
            if (scope === "static" && member.name === "prototype")
                return false;
            const memberDeclaration = member.valueDeclaration || member.declarations?.[0];
            const modifiers = memberDeclaration ? ts.getModifiers(memberDeclaration) || [] : [];
            return !modifiers.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
        }).map(member => {
            const memberDeclaration = member.valueDeclaration || member.declarations?.[0] || declaration;
            const modifiers = ts.getModifiers(memberDeclaration) || [];
            const declarationKinds = (member.declarations || []).map(item => ts.SyntaxKind[item.kind]);
            const accessorKinds = [declarationKinds.includes("GetAccessor") ? "get" : null, declarationKinds.includes("SetAccessor") ? "set" : null].filter(Boolean);
            let signature = logicalCompilerSignature(root, code.checker.typeToString(
                code.checker.getTypeOfSymbolAtLocation(member, memberDeclaration),
                memberDeclaration,
                ts.TypeFormatFlags.NoTruncation,
            ));
            const localAccessors = declaration.members.filter(item =>
                (ts.isGetAccessorDeclaration(item) || ts.isSetAccessorDeclaration(item))
                && item.name.getText() === member.name);
            const getterDeclaration = localAccessors.find(ts.isGetAccessorDeclaration)
                || member.declarations?.find(ts.isGetAccessorDeclaration);
            const setterDeclaration = localAccessors.find(ts.isSetAccessorDeclaration)
                || member.declarations?.find(ts.isSetAccessorDeclaration);
            if (getterDeclaration && setterDeclaration && setterDeclaration.parameters.length === 1) {
                const getterCall = code.checker.getSignatureFromDeclaration(getterDeclaration);
                const getterType = getterCall && code.checker.getReturnTypeOfSignature(getterCall);
                const setterType = code.checker.getTypeAtLocation(setterDeclaration.parameters[0]);
                const getterSignature = getterDeclaration.type
                    ? logicalCompilerSignature(root, getterDeclaration.type.getText())
                    : getterType && logicalCompilerSignature(root,
                        code.checker.typeToString(getterType, getterDeclaration, ts.TypeFormatFlags.NoTruncation));
                const setterSignature = setterDeclaration.parameters[0].type
                    ? logicalCompilerSignature(root, setterDeclaration.parameters[0].type.getText())
                    : logicalCompilerSignature(root,
                        code.checker.typeToString(setterType, setterDeclaration, ts.TypeFormatFlags.NoTruncation));
                if (getterSignature && getterSignature !== setterSignature)
                    signature = `get ${getterSignature}; set ${setterSignature}`;
            }
            return {
                abstract: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword),
                kind: accessorKinds.length > 0 ? accessorKinds.join("+")
                    : ts.isMethodDeclaration(memberDeclaration) || ts.isMethodSignature(memberDeclaration) ? "method" : "property",
                name: member.name,
                scope,
                optional: Boolean(member.flags & ts.SymbolFlags.Optional || memberDeclaration.questionToken),
                readonly: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
                signature,
            };
        });
        const actualMembers = [...collectMembers(instanceType, "instance"), ...collectMembers(classType, "static")]
            .sort((a, b) => `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`));
        const declaredMembers = Array.isArray(obligation.members)
            ? obligation.members.map(member => ({
                abstract: member?.abstract,
                kind: member?.kind,
                name: member?.name,
                scope: member?.scope,
                optional: member?.optional,
                readonly: member?.readonly,
                signature: typeof member?.signature === "string"
                    ? logicalCompilerSignature(root, member.signature) : member?.signature,
            })).sort((a, b) => `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`))
            : null;
        const classModifiers = ts.getModifiers(declaration) || [];
        const sourceConstructors = declaration.members.filter(ts.isConstructorDeclaration);
        const isNonConstructibleClass = classModifiers.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword)
            || sourceConstructors.some(constructor => (ts.getModifiers(constructor) || []).some(modifier =>
                modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword));
        const actualConstructors = isNonConstructibleClass ? [] : classType.getConstructSignatures().map(signature => logicalCompilerSignature(root, code.checker.signatureToString(
            signature,
            declaration,
            ts.TypeFormatFlags.NoTruncation,
            ts.SignatureKind.Construct,
        ))).sort();
        const declaredConstructors = Array.isArray(obligation.constructors)
            ? obligation.constructors.map(signature => logicalCompilerSignature(root, signature)).sort() : null;
        const actualIndexSignatures = [
            ["number", instanceType.getNumberIndexType()],
            ["string", instanceType.getStringIndexType()],
        ].filter(([, type]) => Boolean(type)).map(([key, type]) => ({
            key,
            signature: logicalCompilerSignature(root, code.checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation)),
        }));
        const declaredIndexSignatures = Array.isArray(obligation.indexSignatures) ? obligation.indexSignatures.map(item => ({
            key: item?.key,
            signature: typeof item?.signature === "string" ? logicalCompilerSignature(root, item.signature) : item?.signature,
        })) : null;
        if (!declaredMembers || requiredRoot && declaredMembers.length === 0
            || JSON.stringify(declaredMembers) !== JSON.stringify(actualMembers))
            failures.push(`${label}.members: must exactly pin the public class surface ${JSON.stringify(actualMembers)}`);
        if (!declaredHeritage || JSON.stringify(declaredHeritage) !== JSON.stringify(actualHeritage))
            failures.push(`${label}.heritage: must exactly pin compiler-resolved class heritage ${JSON.stringify(actualHeritage)}`);
        if (!declaredConstructors || JSON.stringify(declaredConstructors) !== JSON.stringify(actualConstructors))
            failures.push(`${label}.constructors: must exactly pin constructor overloads ${JSON.stringify(actualConstructors)}`);
        if (!declaredIndexSignatures || JSON.stringify(declaredIndexSignatures) !== JSON.stringify(actualIndexSignatures))
            failures.push(`${label}.indexSignatures: must exactly pin index signatures ${JSON.stringify(actualIndexSignatures)}`);
    }
}

function filesMatchedByBuildPattern(files, pattern) {
    const normalized = normalize(pattern).replace(/^\.\//, "");
    if (normalized.startsWith("extensions/authoredContent"))
        return files.filter(file => isWithin(file, `src/${normalized.split(/[?*[{]/)[0].replace(/\/$/, "")}`));
    const wildcard = normalized.search(/[?*[{@+!]/);
    if (wildcard < 0) {
        const exact = normalize(path.posix.normalize(`src/layaAir/${normalized}`));
        return files.includes(exact) ? [exact] : [];
    }
    const prefix = normalized.slice(0, wildcard).replace(/\/$/, "");
    const repositoryPrefix = normalize(path.posix.normalize(prefix.length > 0 ? `src/layaAir/${prefix}` : "src/layaAir"));
    return files.filter(file => isWithin(file, repositoryPrefix));
}

function productionReachability(root, files, policy, graph, packageRoots, failures) {
    const roots = new Set(packageRoots);
    for (const [file, edges] of graph) {
        if (roleForFile(file, policy) === "production" && edges.some(edge => {
            const targetRole = roleForFile(edge, policy);
            return targetRole === "core" || targetRole === "layaair" || targetRole === "runtime"
                || targetRole === "editor" || targetRole === "offline-adapter" || targetRole === "flash-api";
        }))
            roots.add(file);
    }
    if (fs.existsSync(absolute(root, BUILD_CONFIG))) {
        const source = ts.createSourceFile(BUILD_CONFIG, fs.readFileSync(absolute(root, BUILD_CONFIG), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const declarations = [];
        for (const statement of source.statements) {
            if (!ts.isVariableStatement(statement))
                continue;
            for (const declaration of statement.declarationList.declarations)
                if (ts.isIdentifier(declaration.name) && declaration.name.text === "allBundles")
                    declarations.push({ declaration, statement });
        }
        if (declarations.length !== 1) {
            failures.push(`${BUILD_CONFIG}: must declare exactly one literal allBundles manifest`);
        } else {
            const { declaration, statement } = declarations[0];
            const exported = ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
            const constant = Boolean(statement.declarationList.flags & ts.NodeFlags.Const);
            if (!exported || !constant || !ts.isArrayLiteralExpression(declaration.initializer)) {
                failures.push(`${BUILD_CONFIG}: allBundles must be an exported const literal array`);
            } else {
                for (const [bundleIndex, element] of declaration.initializer.elements.entries()) {
                    if (!ts.isObjectLiteralExpression(element)) {
                        failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}] must be a literal object without spreads`);
                        continue;
                    }
                    if (element.properties.some(property => !ts.isPropertyAssignment(property)
                        || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)))) {
                        failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}] may contain only statically named property assignments`);
                        continue;
                    }
                    const propertiesNamed = name => element.properties.filter(property => property.name.text === name);
                    const names = propertiesNamed("name");
                    const bundleName = names.length === 1 ? literalText(names[0].initializer) : null;
                    if (names.length !== 1 || bundleName === null)
                        failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}].name must be one literal string`);
                    const globalNames = propertiesNamed("globalName");
                    const globalName = globalNames.length === 1 ? literalText(globalNames[0].initializer) : null;
                    if (globalNames.length > 1 || globalNames.length === 1
                        && (globalName === null || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(globalName)))
                        failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}].globalName must be one literal identifier`);
                    if (bundleName === "flash" && globalName !== "LayaFlash")
                        failures.push(`${BUILD_CONFIG}: the Flash bundle must use the collision-free LayaFlash global`);
                    const addLiteralArray = (property, label) => {
                        if (!property || !ts.isArrayLiteralExpression(property.initializer)) {
                            failures.push(`${BUILD_CONFIG}: ${label} must be one literal array`);
                            return;
                        }
                        for (const item of property.initializer.elements) {
                            const pattern = literalText(item);
                            if (pattern === null) {
                                failures.push(`${BUILD_CONFIG}: ${label} may not use computed values or spreads`);
                                continue;
                            }
                            for (const file of filesMatchedByBuildPattern(files, pattern))
                                roots.add(file);
                        }
                    };
                    const inputs = propertiesNamed("input");
                    if (inputs.length !== 1)
                        failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}].input must occur exactly once`);
                    else
                        addLiteralArray(inputs[0], `allBundles[${bundleIndex}].input`);
                    const copies = propertiesNamed("copy");
                    if (copies.length > 1)
                        failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}].copy may occur at most once`);
                    else if (copies.length === 1)
                        addLiteralArray(copies[0], `allBundles[${bundleIndex}].copy`);
                    const outputs = propertiesNamed("output");
                    if (outputs.length > 1 || outputs.length === 1 && !ts.isObjectLiteralExpression(outputs[0].initializer)) {
                        failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}].output must be one literal object`);
                    } else if (outputs.length === 1) {
                        for (const [outputIndex, output] of outputs[0].initializer.properties.entries()) {
                            if (!ts.isPropertyAssignment(output)
                                || !(ts.isIdentifier(output.name) || ts.isStringLiteral(output.name) || ts.isNumericLiteral(output.name))) {
                                failures.push(`${BUILD_CONFIG}: allBundles[${bundleIndex}].output[${outputIndex}] must be a static literal merge list`);
                                continue;
                            }
                            addLiteralArray(output, `allBundles[${bundleIndex}].output.${output.name.text}`);
                        }
                    }
                }
            }
        }
        const declarationName = declarations[0]?.declaration.name;
        const visitMutation = node => {
            if (ts.isIdentifier(node) && node.text === "allBundles" && node !== declarationName)
                failures.push(`${BUILD_CONFIG}: allBundles may not be referenced or mutated after its literal declaration`);
            ts.forEachChild(node, visitMutation);
        };
        visitMutation(source);
    }
    const reachable = new Set();
    const queue = [...roots];
    while (queue.length > 0) {
        const file = queue.shift();
        if (reachable.has(file))
            continue;
        reachable.add(file);
        for (const target of graph.get(file) || [])
            if (!reachable.has(target))
                queue.push(target);
    }
    return reachable;
}

function inspectProductionClosure(root, reachable, code, policy, failures) {
    for (const file of reachable) {
        const role = roleForFile(file, policy);
        if (role !== "production" && role !== "flash-api")
            continue;
        if (path.extname(file).toLowerCase() === ".json") {
            const document = readJson(root, file, failures);
            if (document) {
                const serialized = JSON.stringify(document);
                const serializedTokens = tokens(serialized);
                if (serializedTokens.some(token => token === "abc" || token === "avm" || token === "avm2")
                    || serializedTokens.some(token => token === "swf" || token === "xfl")
                    || serializedTokens.some(token => ["reader", "parser", "loader", "decoder", "deserializer"].includes(token))
                        && serializedTokens.some(token => ["legacy", "authored", "movie", "timeline", "symbol"].includes(token)))
                    failures.push(`${file}: production JSON contains legacy authored-source or executable-reader declarations`);
                jsonStrings(document, (value, trail) => {
                    if (/schema$/i.test(trail.at(-1) || "") && /authored/i.test(value) && value !== policy.currentDocumentSchema)
                        failures.push(`${file}: production JSON references retired authored schema ${value}`);
                });
            }
            continue;
        }
        const source = code.program.getSourceFile(absolute(root, file));
        if (!source)
            continue;
        const visit = node => {
            if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
                const value = node.text;
                if (!ts.isIdentifier(node) && value.length > 256) {
                    ts.forEachChild(node, visit);
                    return;
                }
                const found = sourceTokens(value);
                if (found.executable.length > 0 || hasAvmSemanticMachinery(value))
                    failures.push(`${file}: production authored/Flash closure may not contain ABC/AVM/QName/cinit/admission/trait machinery (${value})`);
                if (compatibilityImplementation(value)
                    && tokens(value).some(part => ["authored", "movie", "timeline", "symbol", "document"].includes(part)))
                    failures.push(`${file}: production authored/Flash closure contains a forbidden compatibility implementation (${value})`);
                if (isAuthoredReaderName(value))
                    failures.push(`${file}: production authored/Flash closure contains legacy authored reader/decoder surface (${value})`);
            }
            if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
                const declaredName = classLikeName(node);
                const parts = tokens(declaredName);
                if (parts.includes("trait"))
                    failures.push(`${file}: production authored/Flash closure contains AVM-style trait class ${declaredName}`);
                if (isAuthoredReaderName(declaredName))
                    failures.push(`${file}: production authored/Flash closure contains legacy authored reader/parser ${declaredName}`);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
}

function inspectMandatoryScripts(root, failures) {
    const manifest = readJson(root, ROOT_PACKAGE, failures);
    if (!manifest)
        return;
    const scripts = manifest.scripts;
    const check = "node scripts/checkAuthoredContentAdmission.mjs";
    const test = "node --test tests/architecture/authoredContentAdmission.test.mjs";
    const verify = "node scripts/checkAuthoredContentAdmission.mjs --verify-evidence";
    if (scripts?.["check:authored-content-admission"] !== check)
        failures.push(`${ROOT_PACKAGE}: mandatory check:authored-content-admission script must be '${check}'`);
    if (scripts?.["test:authored-content-admission"] !== test)
        failures.push(`${ROOT_PACKAGE}: mandatory test:authored-content-admission script must be '${test}'`);
    if (scripts?.["verify:authored-content-capabilities"] !== verify)
        failures.push(`${ROOT_PACKAGE}: mandatory verify:authored-content-capabilities script must be '${verify}'`);
    const build = "npm run check:authored-content-admission && npm run verify:authored-content-capabilities && node scripts/buildEngine.mjs";
    if (scripts?.build !== build)
        failures.push(`${ROOT_PACKAGE}: build must be exactly '${build}'`);
}

export function inspectAuthoredContentAdmission(rootDirectory) {
    const root = path.resolve(rootDirectory);
    const failures = [];
    const policy = readJson(root, POLICY_FILE, failures);
    if (!policy)
        return Object.freeze({ failures: Object.freeze(failures), blockingCapabilities: Object.freeze([]), productionReady: false, syntheticBlockingCapabilities: Object.freeze([]) });
    for (const [field, expected] of Object.entries(REQUIRED_POLICY_VALUES))
        if (policy[field] !== expected)
            failures.push(`${POLICY_FILE}: ${field} must be ${expected}`);
    const requiredIds = new Set(policy.requiredCapabilities || []);
    if (requiredIds.size !== policy.requiredCapabilities?.length)
        failures.push(`${POLICY_FILE}: requiredCapabilities must be unique`);
    for (const id of REQUIRED_POLICY_CAPABILITIES)
        if (!requiredIds.has(id))
            failures.push(`${POLICY_FILE}: requiredCapabilities may not omit ${id}`);
    if (JSON.stringify(policy.statuses) !== JSON.stringify(REQUIRED_STATUSES))
        failures.push(`${POLICY_FILE}: statuses must be the canonical admission dispositions`);
    const files = discover(root);
    inspectFlashNamespaces(files, policy, requiredIds, failures);
    inspectMandatoryScripts(root, failures);
    const options = compilerOptions(root, failures);
    const program = sourceProgram(root, files, options);
    const code = inspectCode(root, files, program, options, policy, failures);
    const packageRoots = inspectPackages(root, files, policy, failures);
    const syntheticBlockingCapabilities = new Set();
    inspectJsonDocuments(root, files, policy, requiredIds, failures, syntheticBlockingCapabilities);
    const ledger = inspectCapabilityLedger(root, policy, code, failures);
    const reachable = productionReachability(root, files, policy, code.graph, packageRoots, failures);
    inspectProductionClosure(root, reachable, code, policy, failures);
    const runtimeReachable = [...reachable].some(file => {
        const role = roleForFile(file, policy);
        return role === "core" || role === "layaair" || role === "runtime";
    });
    const editorReachable = [...reachable].filter(file => {
        const role = roleForFile(file, policy);
        return role === "editor" || role === "offline-adapter";
    });
    if (editorReachable.length > 0)
        failures.push(`production reachability includes editor-only authored modules: ${editorReachable.sort().join(", ")}`);
    if (runtimeReachable && ledger.blockingIds.length > 0)
        failures.push(`authored runtime is production-reachable while capabilities remain blocking: ${ledger.blockingIds.sort().join(", ")}`);
    const bridgeReachable = [...reachable].some(file => roleForFile(file, policy) === "flash-api");
    const bridgeBlocking = ledger.blockingIds.filter(id => id.startsWith("api.flash."));
    if (bridgeReachable && bridgeBlocking.length > 0)
        failures.push(`Flash API bridge is production-reachable while bridge capabilities remain blocking: ${bridgeBlocking.sort().join(", ")}`);
    const ownedBridgeExports = new Map();
    for (const modules of ledger.bridgeOwnership.values())
        for (const [file, exports] of modules)
            if (!ownedBridgeExports.has(file))
                ownedBridgeExports.set(file, new Set(exports));
            else
                for (const name of exports)
                    ownedBridgeExports.get(file).add(name);
    const reachableBridgeFiles = [...reachable].filter(file => roleForFile(file, policy) === "flash-api"
        && CODE_EXTENSIONS.has(path.extname(file).toLowerCase()));
    for (const file of reachableBridgeFiles) {
        const local = file.slice(policy.flashApiBridgeRoot.length + 1);
        const rootBarrel = !local.includes("/") && /^(?:index|ModuleDef)\.[cm]?[jt]sx?$/i.test(local);
        const source = code.program.getSourceFile(absolute(root, file));
        if (rootBarrel && source) {
            if (source.statements.some(statement => !ts.isExportDeclaration(statement) || !statement.moduleSpecifier))
                failures.push(`${file}: Flash root barrel may contain only export-from declarations`);
            const moduleSymbol = code.checker.getSymbolAtLocation(source);
            for (const exported of moduleSymbol ? code.checker.getExportsOfModule(moduleSymbol) : []) {
                const resolvedExport = exported.flags & ts.SymbolFlags.Alias ? code.checker.getAliasedSymbol(exported) : exported;
                const declarations = resolvedExport.declarations || [];
                const owned = declarations.some(declaration => {
                    const ownerFile = relative(root, declaration.getSourceFile().fileName);
                    return ownedBridgeExports.get(ownerFile)?.has(exported.name);
                });
                if (!owned)
                    failures.push(`${file}: re-exported Flash API ${exported.name} is not owned by an exact namespace obligation`);
            }
            continue;
        }
        if (!ownedBridgeExports.has(file))
            failures.push(`${file}: reachable Flash API source is not hash/surface-owned by its api.flash.* capability`);
        if (source) {
            const moduleSymbol = code.checker.getSymbolAtLocation(source);
            const declaredExports = moduleSymbol ? code.checker.getExportsOfModule(moduleSymbol).map(symbol => symbol.name) : [];
            const ownedExports = ownedBridgeExports.get(file) || new Set();
            for (const name of declaredExports)
                if (!ownedExports.has(name))
                    failures.push(`${file}: public Flash API export ${name} lacks an exact hash/surface obligation`);
        }
    }
    if (runtimeReachable && bridgeBlocking.length === 0 && !bridgeReachable)
        failures.push(`production-ready authored runtime requires a production-reachable Flash API bridge`);
    if (bridgeBlocking.length === 0) {
        for (const namespace of policy.flashApiNamespaces) {
            const id = `api.${namespace}`;
            const owned = ledger.bridgeOwnership.get(id) || new Map();
            if (![...owned.keys()].some(file => reachable.has(file)))
                failures.push(`${id}: admitted Flash namespace has no production-reachable owned module`);
        }
    }
    const productionReady = failures.length === 0 && runtimeReachable && bridgeReachable && ledger.blockingIds.length === 0;
    return Object.freeze({
        failures: Object.freeze([...new Set(failures)].sort()),
        blockingCapabilities: Object.freeze(ledger.blockingIds.sort()),
        productionReady,
        reachable: Object.freeze([...reachable].sort()),
        evidenceFiles: Object.freeze([...ledger.evidenceFiles].sort()),
        syntheticBlockingCapabilities: Object.freeze([...syntheticBlockingCapabilities].sort()),
    });
}

export function assertAuthoredContentAdmission(rootDirectory) {
    const result = inspectAuthoredContentAdmission(rootDirectory);
    if (result.failures.length > 0)
        throw new Error(["Authored-content admission guard failed:", ...result.failures.map(failure => `- ${failure}`)].join("\n"));
    return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) {
    const arguments_ = process.argv.slice(2);
    const verifyEvidence = arguments_.includes("--verify-evidence");
    const rootArgument = arguments_.find(argument => !argument.startsWith("--"));
    const root = rootArgument ? path.resolve(rootArgument) : path.resolve(path.dirname(SCRIPT_FILE), "..");
    const result = assertAuthoredContentAdmission(root);
    if (verifyEvidence && result.evidenceFiles.length > 0) {
        const executed = spawnSync(process.execPath, ["--test", ...result.evidenceFiles], { cwd: root, stdio: "inherit" });
        if (executed.error)
            throw executed.error;
        if (executed.status !== 0)
            throw new Error(`Authored-content capability evidence failed with exit code ${executed.status}`);
    }
    const readiness = result.productionReady ? "production-ready" : `${result.blockingCapabilities.length} capabilities explicitly blocking`;
    console.log(`Authored-content admission guard passed (${readiness}).`);
}
