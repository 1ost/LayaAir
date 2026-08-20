import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-stage-browser-"));
const script = join(temporaryDirectory, "flash-stage.browser.js");
const page = join(temporaryDirectory, "index.html");
const chromeCandidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

try {
    await build({
        entryPoints: [join(root, "tests/flashStage/flash-stage.browser.ts")],
        outfile: script,
        bundle: true,
        platform: "browser",
        format: "iife",
        target: "chrome110",
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        logLevel: "warning",
    });
    await writeFile(page, "<!doctype html><body data-result=\"pending\"><script src=\"./flash-stage.browser.js\"></script></body>\n");
    const { existsSync } = await import("node:fs");
    const browser = chromeCandidates.find(existsSync);
    assert.ok(browser, "Chrome or Edge is required for the Flash Stage browser gate");
    const result = spawnSync(browser, [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--allow-file-access-from-files",
        "--dump-dom",
        pathToFileURL(page).href,
    ], { cwd: temporaryDirectory, encoding: "utf8", timeout: 60_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /data-result="passed"/,
        `Chromium Stage gate failed:\n${result.stdout}\n${result.stderr}`);
    console.log("Flash Stage/display-root Chromium scheduler gate passed");
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
