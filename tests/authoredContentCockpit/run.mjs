import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..", "..");
const installedTypes = path.join(
    process.env.LOCALAPPDATA || "",
    "Programs", "LayaAirIDE", "resources", "engine", "types"
);
const tsc = path.join(
    process.env.LOCALAPPDATA || "",
    "Programs", "LayaAirIDE", "resources", "node_modules", "typescript", "lib", "tsc.js"
);
const sources = path.join(root, "src", "extensions", "authoredContent", "cockpit");
const temporary = mkdtempSync(path.join(tmpdir(), "authored-cockpit-test-"));

function runTsc(args) {
    execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: "inherit" });
}

try {
    runTsc([
        "--target", "es2020",
        "--module", "commonjs",
        "--strict",
        "--skipLibCheck",
        "--outDir", temporary,
        path.join(sources, "AuthoredContentCockpitTypes.ts"),
        path.join(sources, "AuthoredContentCockpitModel.ts"),
        path.join(testDir, "run.ts")
    ]);
    execFileSync(process.execPath, [path.join(temporary, "tests", "authoredContentCockpit", "run.js")], {
        cwd: root,
        stdio: "inherit"
    });

    runTsc([
        "--target", "es2020",
        "--module", "commonjs",
        "--strict",
        "--skipLibCheck",
        "--outDir", temporary,
        path.join(installedTypes, "editor-ui.d.ts"),
        path.join(installedTypes, "editor.d.ts"),
        path.join(sources, "AuthoredContentCockpitTypes.ts"),
        path.join(sources, "AuthoredContentCockpitBridge.ts"),
        path.join(sources, "AuthoredContentCockpitPanelSupport.ts"),
        path.join(sources, "AuthoredPreviewCanvasController.ts"),
        path.join(testDir, "runPanel.ts")
    ]);
    execFileSync(process.execPath, [path.join(temporary, "tests", "authoredContentCockpit", "runPanel.js")], {
        cwd: root,
        stdio: "inherit"
    });

    runTsc([
        "--noEmit",
        "--target", "es2020",
        "--module", "es2020",
        "--strict",
        "--skipLibCheck",
        "--lib", "es2020,dom",
        path.join(installedTypes, "editor-ui.d.ts"),
        path.join(installedTypes, "LayaAir.d.ts"),
        path.join(installedTypes, "editor.d.ts"),
        path.join(sources, "AuthoredContentCockpitTypes.ts"),
        path.join(sources, "AuthoredContentCockpitModel.ts"),
        path.join(sources, "AuthoredContentCockpitPanel.ts")
    ]);

    const panel = readFileSync(path.join(sources, "AuthoredContentCockpitPanel.ts"), "utf8");
    const bridge = readFileSync(path.join(sources, "AuthoredContentCockpitBridge.ts"), "utf8");
    const previewController = readFileSync(path.join(sources, "AuthoredPreviewCanvasController.ts"), "utf8");
    const uiMain = readFileSync(path.join(root, "src", "extensions", "authoredContent", "UIMain.ts"), "utf8");
    const buildScript = readFileSync(path.join(root, "src", "extensions", "authoredContent", "scripts", "build.mjs"), "utf8");
    const rootPackage = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    for (const required of [
        "AuthoredContentPreviewScene",
        '"source"', '"base"', '"final"',
        '"reimport"', '"detach"', '"validate"', '"render"',
        "Open XML", "COMPATIBILITY", "BINDINGS", "FLASH-SHAPED BRIDGE OBLIGATIONS", "CONFLICTS",
        "Editor.enableHotkey", "focusable", "tabStop",
        "AuthoredAsyncEpoch", "isCaptureCurrent", "captureFocusedWidgetName", "restoreNamedFocus",
        "AuthoredPreviewCanvasController", "resolveAndPresent"
    ]) {
        assert.ok(panel.includes(required), `panel must include ${required}`);
    }
    for (const required of [
        "AuthoredContentCockpitSceneBridge",
        "${AUTHORED_COCKPIT_SCENE_BRIDGE}.getSnapshot",
        "${AUTHORED_COCKPIT_SCENE_BRIDGE}.resolvePreview",
        "${AUTHORED_COCKPIT_SCENE_BRIDGE}.${action}"
    ]) {
        assert.ok(bridge.includes(required), `bridge seam must include ${required}`);
    }
    assert.ok(uiMain.includes('import "./cockpit/AuthoredContentCockpitPanel";'), "UIMain must register the cockpit in the UI process");
    assert.equal(rootPackage.scripts["build:authored-content"], "npm --prefix src/extensions/authoredContent run build");
    assert.equal(rootPackage.scripts["test:authored-content"], "npm --prefix src/extensions/authoredContent run test");
    for (const output of [
        "cockpit/AuthoredContentCockpitBridge.js",
        "cockpit/AuthoredContentCockpitModel.js",
        "cockpit/AuthoredContentCockpitPanel.js",
        "cockpit/AuthoredContentCockpitPanelSupport.js",
        "cockpit/AuthoredContentCockpitTypes.js",
        "cockpit/AuthoredPreviewCanvasController.js"
    ]) {
        assert.ok(buildScript.includes(`\"${output}\"`), `exact package inventory must include ${output}`);
    }
    assert.ok(panel.indexOf("capture = this.model.captureAction(action)") < panel.indexOf("await Editor.showMessageBox"), "detach must capture the exact target before confirmation");
    assert.ok(panel.includes("capture.symbolLabel") && panel.includes("capture.request.symbolId"), "detach confirmation must name its captured target");
    for (const guard of ["snapshotEpoch.isCurrent", "previewEpoch.isCurrent", "actionEpoch.isCurrent", "this.destroyed"]) {
        assert.ok(panel.includes(guard), `panel must guard async completion with ${guard}`);
    }
    for (const required of ["mutationTail", "releaseObject", "createObject", "This controller still owns the mutation lock"]) {
        assert.ok(previewController.includes(required), `serialized preview controller must include ${required}`);
    }
    for (const forbidden of [
        /\bIEditorEnv\b/,
        /\bAssetImporter\b/,
        /\bHierarchyWriter\b/,
        /\bLaya\./,
        /\brequire\s*\(/,
        /from\s+["'](?:node:)?fs["']/,
        /\.swf\b/i,
        /\.abc\b/i
    ]) {
        assert.doesNotMatch(panel + bridge + previewController, forbidden, `UI-process cockpit contains forbidden implementation: ${forbidden}`);
    }
    console.log("PASS installed-IDE UI typecheck, UIMain/root wiring, and process-boundary checks");
} finally {
    rmSync(temporary, { recursive: true, force: true });
}
