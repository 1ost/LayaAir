import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-system-host-"));
const runnerOutput = join(temporaryDirectory, "flash-system-host.test.mjs");
const browserOutput = join(temporaryDirectory, "flash-system-host.browser.js");
const browserHtml = join(temporaryDirectory, "index.html");

try {
    await build({
        entryPoints: [join(root, "tests/flashSystemHost/flash-system-host.runner.ts")],
        outfile: runnerOutput, bundle: true, platform: "node", format: "esm", target: "node18",
        sourcemap: "inline", logLevel: "warning",
    });
    await build({
        entryPoints: [join(root, "tests/flashSystemHost/flash-system-host.browser.ts")],
        outfile: browserOutput, bundle: true, platform: "browser", format: "iife", target: "chrome100",
        logLevel: "warning",
    });
    const result = spawnSync(process.execPath, ["--test", runnerOutput], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Node system/host tests exited ${result.status}`);

    const chromium = findChromium();
    if (!chromium) throw new Error("Chromium was not found. Set CHROMIUM_PATH to Chrome or Chromium.");
    await writeFile(browserHtml,
        "<!doctype html><meta charset=utf-8><title>Flash system host browser gate</title><body><script src=flash-system-host.browser.js></script></body>",
        "utf8");
    const browser = spawnSync(chromium, [
        "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
        "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-dev-shm-usage",
        "--allow-file-access-from-files", "--virtual-time-budget=5000", "--dump-dom",
        `file:///${browserHtml.replaceAll("\\", "/")}`,
    ], { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (browser.error) throw browser.error;
    assert.equal(browser.status, 0, `Chromium exited ${browser.status}:\n${browser.stderr}`);
    const match = browser.stdout.match(/<pre id="flash-system-host-browser-result">([^<]*)<\/pre>/);
    assert.ok(match, `System/host browser marker missing:\n${browser.stdout.slice(-4000)}`);
    const payload = JSON.parse(decodeHtml(match[1]));
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.version, "LAYA 3,4,0,0");
    assert.equal(typeof payload.language, "string");
    assert.equal(typeof payload.os, "string");
    assert.equal(Number.isSafeInteger(payload.memory), true);
    console.log("Flash system/host Chromium gate passed");
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

function decodeHtml(value) {
    return value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function findChromium() {
    const candidates = [process.env.CHROMIUM_PATH, process.env.CHROME_PATH,
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
        .filter(Boolean).map(value => resolve(value));
    return candidates.find(existsSync) || null;
}
