import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const chromium = findChromium();
if (!chromium) throw new Error("Chromium was not found. Set CHROMIUM_PATH to a Chrome or Chromium executable.");

const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-filter-gpu-"));
try {
    const bundle = join(temporaryDirectory, "flash-filter-gpu.js");
    const html = join(temporaryDirectory, "index.html");
    await build({
        entryPoints: [join(root, "tests/flashFilters/flash-filters.gpu.ts")],
        outfile: bundle,
        bundle: true,
        platform: "browser",
        format: "iife",
        target: "chrome100",
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        logLevel: "warning",
    });
    await writeFile(html, "<!doctype html><meta charset=utf-8><title>Flash filter GPU gate</title><body><script src=flash-filter-gpu.js></script></body>", "utf8");
    const result = spawnSync(chromium, [
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-dev-shm-usage",
        "--enable-unsafe-swiftshader",
        "--allow-file-access-from-files",
        "--virtual-time-budget=20000",
        "--dump-dom",
        `file:///${html.replaceAll("\\", "/")}`,
    ], { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Chromium exited ${result.status}:\n${result.stderr}`);
    const match = result.stdout.match(/<pre id="flash-filter-gpu-result">([^<]*)<\/pre>/);
    assert.ok(match, `GPU result marker missing. Chromium stderr:\n${result.stderr}\nDOM:\n${result.stdout.slice(-4000)}`);
    const payload = JSON.parse(decodeHtml(match[1]));
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.result.renderer, "WebGL", `Unexpected renderer: ${JSON.stringify(payload.result)}`);
    console.log(`Flash filter GPU pixel gate passed (${payload.result.renderer})`);
    console.log(JSON.stringify(payload.result));
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

function decodeHtml(value) {
    return value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function findChromium() {
    const candidates = [
        process.env.CHROMIUM_PATH,
        process.env.CHROME_PATH,
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
        join(process.env.LOCALAPPDATA || "", "Chromium/Application/chrome.exe"),
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ].filter(Boolean).map(value => resolve(value));
    return candidates.find(existsSync) || null;
}
