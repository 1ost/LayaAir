import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(pluginRoot, "../../..");
const packageRoot = path.join(repositoryRoot, "build", "ide-packages", "laya-authored-content-editor");
const installedTypes = resolveInstalledTypes();

await fs.promises.rm(packageRoot, { recursive: true, force: true });
await fs.promises.mkdir(packageRoot, { recursive: true });

compile("UI", [
    path.join(installedTypes, "editor.d.ts"),
    path.join(installedTypes, "editor-ui.d.ts"),
    path.join(pluginRoot, "UIMain.ts")
]);
compile("Scene", [
    path.join(installedTypes, "editor-env.d.ts"),
    path.join(installedTypes, "LayaAir.d.ts"),
    path.join(pluginRoot, "EnvMain.ts")
]);

await fs.promises.cp(path.join(pluginRoot, "editorResources"), path.join(packageRoot, "editorResources"), { recursive: true });
const manifest = JSON.parse(await fs.promises.readFile(path.join(pluginRoot, "package.json"), "utf8"));
manifest.main = "UIMain.js";
delete manifest.scripts;
await fs.promises.writeFile(path.join(packageRoot, "package.json"), JSON.stringify(manifest, null, 2) + os.EOL);

const expectedOutputs = [
    "EnvMain.js",
    "UIMain.js",
    "offlineAdapters/SwfXmlSourceAdapter.js",
    "offlineAdapters/XflBundleSourceAdapter.js",
    "cockpit/AuthoredContentCockpitBridge.js",
    "cockpit/AuthoredContentCockpitModel.js",
    "cockpit/AuthoredContentCockpitPanel.js",
    "cockpit/AuthoredContentCockpitPanelSupport.js",
    "cockpit/AuthoredContentCockpitTypes.js",
    "cockpit/AuthoredPreviewCanvasController.js",
    "core/NeutralAuthoredContentIR.js",
    "core/AuthoredRuntimeIds.js",
    "core/SourceAdapter.js",
    "editorResources/authored-content-source.svg",
    "emit/EditorSubAssetState.js",
    "emit/NativeAnimationClip2DWriter.js",
    "emit/NativeAssetImporterTransaction.js",
    "emit/NativeLayaHierarchyWriter.js",
    "emit/NativeLayaEmitter.js",
    "package.json"
].sort();
const actualOutputs = (await listFiles(packageRoot)).sort();
if (JSON.stringify(actualOutputs) !== JSON.stringify(expectedOutputs)) {
    throw new Error(
        `AUTHORED_CONTENT_PACKAGE_INVENTORY_MISMATCH:\nexpected=${expectedOutputs.join(",")}\nactual=${actualOutputs.join(",")}`
    );
}
console.log(`Authored Content IDE package staged at ${packageRoot}`);

function compile(label, rootNames) {
    rootNames.forEach(file => {
        if (!fs.existsSync(file))
            throw new Error(`AUTHORED_CONTENT_IDE_TYPE_OR_ENTRY_MISSING: ${file}`);
    });
    const options = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
        experimentalDecorators: true,
        strict: true,
        skipLibCheck: true,
        noEmitOnError: true,
        rootDir: pluginRoot,
        outDir: packageRoot,
        sourceMap: false,
        declaration: false
    };
    const program = ts.createProgram({ rootNames, options });
    const result = program.emit();
    const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
    if (diagnostics.length > 0) {
        const host = {
            getCanonicalFileName: file => file,
            getCurrentDirectory: () => repositoryRoot,
            getNewLine: () => os.EOL
        };
        throw new Error(`Authored Content ${label} build failed:\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, host)}`);
    }
}

function resolveInstalledTypes() {
    const configured = process.env.LAYAAIR_IDE_TYPES;
    if (configured)
        return path.resolve(configured);
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        return path.join(process.env.LOCALAPPDATA, "Programs", "LayaAirIDE", "resources", "engine", "types");
    }
    throw new Error("AUTHORED_CONTENT_IDE_TYPES_REQUIRED: Set LAYAAIR_IDE_TYPES to the LayaAir IDE 3.4 types directory.");
}

async function listFiles(directory, relative = "") {
    const result = [];
    for (const entry of await fs.promises.readdir(path.join(directory, relative), { withFileTypes: true })) {
        const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
        if (entry.isDirectory())
            result.push(...await listFiles(directory, child));
        else
            result.push(child);
    }
    return result;
}
