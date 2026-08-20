import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = process.argv[2] ? resolve(process.argv[2]) : null;
if (!sourceRoot)
    throw new Error("usage: node scripts/testAuthoredSymbol21Browser.mjs <absolute-flash-library-root>");

const chromium = findChromium();
if (!chromium)
    throw new Error("Chromium was not found. Set CHROMIUM_PATH to a Chrome or Chromium executable.");

const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-authored-symbol21-browser-"));
const outputRoot = join(temporaryDirectory, "bundle");
const screenshot = process.env.SYMBOL21_SCREENSHOT_PATH
    ? resolve(process.env.SYMBOL21_SCREENSHOT_PATH)
    : join(temporaryDirectory, "symbol21.png");
try {
    const emission = spawnSync(process.execPath, [
        join(root, "src/extensions/authoredContent/scripts/emitFlashLibrarySymbolBundle.cjs"),
        sourceRoot,
        outputRoot,
        "21",
        "Processors_Mini.Accessories.LoadingScreenSkin",
    ], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (emission.error) throw emission.error;
    assert.equal(emission.status, 0, `symbol21 emission failed:\n${emission.stderr}`);

    const hierarchy = JSON.parse(await readFile(join(outputRoot, "bootstrap-loading.lh"), "utf8"));
    assert.equal(hierarchy._$type, "Sprite");
    assert.equal(hierarchy._$runtime, "Processors_Mini.Accessories.LoadingScreenSkin");
    const files = await listFiles(outputRoot);
    const clips = Object.fromEntries(await Promise.all(files
        .filter(file => file.endsWith(".mc"))
        .map(async file => [portable(relative(outputRoot, file)), (await readFile(file)).toString("base64")])));
    const images = Object.fromEntries(await Promise.all(files
        .filter(file => /\.(?:png|jpe?g)$/i.test(file))
        .map(async file => {
            const id = portable(relative(outputRoot, file));
            const extension = basename(file).toLowerCase().endsWith(".png") ? "png" : "jpeg";
            return [id, `data:image/${extension};base64,${(await readFile(file)).toString("base64")}`];
        })));
    assert.deepEqual(Object.keys(clips).sort(), [
        "bootstrap-loading.mc",
        "timelines/nested-1.mc",
        "timelines/nested-2.mc",
    ]);
    assert.equal(Object.keys(images).length, 7);

    const browserScript = join(temporaryDirectory, "symbol21.browser.js");
    await build({
        entryPoints: [join(root, "tests/authoredContent/symbol21.browser.ts")],
        outfile: browserScript,
        bundle: true,
        platform: "browser",
        format: "iife",
        target: "chrome110",
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        logLevel: "warning",
    });
    await writeFile(join(temporaryDirectory, "symbol21-data.js"),
        `window.__symbol21Bundle=${JSON.stringify({ hierarchy, clips, images })};\n`, "utf8");
    const page = join(temporaryDirectory, "index.html");
    await writeFile(page, `<!doctype html>
<meta charset="utf-8">
<title>Authored symbol21 browser gate</title>
<style>html,body{margin:0;width:1250px;height:650px;overflow:hidden;background:#000}</style>
<body><script src="symbol21-data.js"></script><script src="symbol21.browser.js"></script></body>\n`, "utf8");
    const browser = spawnSync(chromium, [
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
        "--window-size=1250,650",
        `--screenshot=${screenshot}`,
        "--dump-dom",
        pathToFileURL(page).href,
    ], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (browser.error) throw browser.error;
    assert.equal(browser.status, 0, `Chromium exited ${browser.status}:\n${browser.stderr}`);
    const match = browser.stdout.match(/<pre id="symbol21-result"[^>]*>([^<]*)<\/pre>/);
    assert.ok(match, `symbol21 result marker missing. Chromium stderr:\n${browser.stderr}\nDOM:\n${browser.stdout.slice(-6000)}`);
    const payload = JSON.parse(decodeHtml(match[1]));
    assert.equal(payload.ok, true, payload.error);
    assert.deepEqual(payload.result.childNames, [
        "HappyBear",
        "SP_ProgressBigBar",
        "TF_ProgressText",
        "TF_LoadingTips",
        "TF_LoadingTipsExtra",
    ]);
    assert.deepEqual(payload.result.formats, [
        ["Arial", 14, true],
        ["Arial", 12, false],
        ["Arial", 12, false],
    ]);
    assert.equal(payload.result.progressScaleX, 0.5);
    assert.equal(payload.result.totalFrames, 16);
    assert.equal(payload.result.playback.start, 1);
    assert.notEqual(payload.result.playback.end, payload.result.playback.start);
    assert.deepEqual(payload.result.poses.map(value => [value.frame, value.active]), [
        [1, 0], [5, 1], [9, 2], [13, 3],
    ]);
    assert.equal(new Set(payload.result.poses.map(value => value.pixelHash)).size, 4);
    assert.ok(existsSync(screenshot), "Chromium did not create the symbol21 screenshot");
    console.log("Authored symbol21 Chromium behavior/render gate passed");
    console.log(JSON.stringify(payload.result));
    if (process.env.SYMBOL21_SCREENSHOT_PATH)
        console.log(`Screenshot: ${screenshot}`);
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

async function listFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
        const fullPath = join(directory, entry.name);
        return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }));
    return nested.flat();
}

function portable(value) {
    return value.replaceAll("\\", "/");
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
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ].filter(Boolean).map(value => resolve(value));
    return candidates.find(existsSync) || null;
}
