import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-byte-array-tests-"));
const runnerOutput = join(temporaryDirectory, "flash-byte-array.test.mjs");
const browserOutput = join(temporaryDirectory, "flash-byte-array.browser.js");
const browserHtml = join(temporaryDirectory, "index.html");

try {
    await build({
        entryPoints: [join(root, "tests/flashByteArray/flash-byte-array.runner.ts")],
        outfile: runnerOutput,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: { js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};" },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        sourcemap: "inline",
        logLevel: "warning"
    });
    await build({
        entryPoints: [join(root, "tests/flashByteArray/flash-byte-array.browser.ts")],
        outfile: browserOutput,
        bundle: true,
        platform: "browser",
        format: "iife",
        target: "chrome100",
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        logLevel: "warning"
    });
    const result = spawnSync(process.execPath, ["--test", runnerOutput], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Node ByteArray tests exited ${result.status}`);

    const chromium = findChromium();
    if (!chromium)
        throw new Error("Chromium was not found. Set CHROMIUM_PATH to a Chrome or Chromium executable.");
    await writeFile(browserHtml,
        "<!doctype html><meta charset=utf-8><title>Flash ByteArray browser gate</title><body><script src=flash-byte-array.browser.js></script></body>",
        "utf8");
    const browser = spawnSync(chromium, [
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-dev-shm-usage",
        "--allow-file-access-from-files",
        "--virtual-time-budget=10000",
        "--dump-dom",
        `file:///${browserHtml.replaceAll("\\", "/")}`,
    ], { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (browser.error) throw browser.error;
    assert.equal(browser.status, 0, `Chromium exited ${browser.status}:\n${browser.stderr}`);
    const match = browser.stdout.match(/<pre id="flash-byte-array-browser-result">([^<]*)<\/pre>/);
    assert.ok(match, `ByteArray browser result marker missing. Chromium stderr:\n${browser.stderr}\nDOM:\n${browser.stdout.slice(-4000)}`);
    const payload = JSON.parse(decodeHtml(match[1]));
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.result.defaultCapability, true);
    console.log("Flash ByteArray Chromium gate passed");
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
