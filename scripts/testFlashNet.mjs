import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-net-tests-"));
const runnerOutput = join(temporaryDirectory, "flash-net.test.mjs");
const browserOutput = join(temporaryDirectory, "flash-net.browser.js");
let server;

try {
    await build({
        entryPoints: [join(root, "tests/flashNet/flash-net.runner.ts")],
        outfile: runnerOutput,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: { js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {}; Object.defineProperty(globalThis, 'navigator', { value: globalThis.navigator ?? {}, configurable: true });" },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        sourcemap: "inline",
        logLevel: "warning",
    });
    await build({
        entryPoints: [join(root, "tests/flashNet/flash-net.browser.ts")],
        outfile: browserOutput,
        bundle: true,
        platform: "browser",
        format: "iife",
        target: "chrome100",
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        logLevel: "warning",
    });
    const node = spawnSync(process.execPath, ["--test", runnerOutput], { cwd: root, stdio: "inherit" });
    if (node.error) throw node.error;
    assert.equal(node.status, 0, `Node Flash net tests exited ${node.status}`);

    let observedLog = "";
    const requestPaths = [];
    const browserSource = await readFile(browserOutput);
    server = http.createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        requestPaths.push(url.pathname);
        if (url.pathname === "/") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            response.end(`<!doctype html><meta charset=utf-8><title>Flash net browser gate</title>
<script>
function publishBootFailure(value) {
  const marker = document.createElement("pre"); marker.id = "flash-net-browser-result";
  marker.textContent = JSON.stringify({ ok: false, error: String(value && (value.stack || value.message || value.reason) || value) });
  document.body.appendChild(marker);
}
window.onerror = (_message, _source, _line, _column, error) => publishBootFailure(error || _message);
window.onunhandledrejection = event => publishBootFailure(event.reason);
</script><script src=/bundle.js></script>`);
        } else if (url.pathname === "/bundle.js") {
            response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
            response.end(browserSource);
        } else if (url.pathname === "/binary") {
            response.writeHead(200, { "content-type": "application/octet-stream", "content-length": "4" });
            response.end(Buffer.from([0x12, 0x34, 0x56, 0x78]));
        } else if (url.pathname === "/log") {
            observedLog = url.searchParams.get("log") ?? "";
            response.writeHead(204);
            response.end();
        } else if (url.pathname === "/observed") {
            const body = `log=${encodeURIComponent(observedLog)}`;
            response.writeHead(200, { "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(body)) });
            response.end(body);
        } else {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.equal(typeof address, "object");

    const chromium = findChromium();
    if (!chromium) throw new Error("Chromium was not found. Set CHROMIUM_PATH to Chrome or Chromium.");
    const browser = await runProcess(chromium, [
        "--headless=new", "--no-first-run", "--no-default-browser-check",
        "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
        "--disable-extensions", "--disable-dev-shm-usage", "--virtual-time-budget=10000", "--dump-dom",
        `http://127.0.0.1:${address.port}/`,
    ], root, 60000);
    assert.equal(browser.status, 0, `Chromium exited ${browser.status}:\n${browser.stderr}`);
    const match = browser.stdout.match(/<pre id="flash-net-browser-result">([^<]*)<\/pre>/);
    assert.ok(match, `Flash net browser marker missing; requests=${requestPaths.join(",")}:\n${browser.stderr}\n${browser.stdout.slice(-4000)}`);
    const payload = JSON.parse(decodeHtml(match[1]));
    assert.equal(payload.ok, true, payload.error);
    assert.deepEqual(payload.result, {
        binaryValue: 0x12345678,
        firstEvent: "status:200",
        finalEvent: "complete",
        progressMonotonic: true,
        observedLog: "browser producer",
        persisted: 9,
        persistedNull: null,
        liveWasObject: true,
        collision: true,
    });
    console.log("Flash net Chromium producer gate passed");
} finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(temporaryDirectory, { recursive: true, force: true });
}

function decodeHtml(value) {
    return value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function findChromium() {
    const candidates = [
        process.env.CHROMIUM_PATH, process.env.CHROME_PATH,
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
        join(process.env.LOCALAPPDATA || "", "Chromium/Application/chrome.exe"),
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ].filter(Boolean).map(value => resolve(value));
    return candidates.find(existsSync) || null;
}

function runProcess(command, arguments_, cwd, timeout) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, arguments_, { cwd, windowsHide: true });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill(), timeout);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => {
            stdout += chunk;
            if (stdout.length > 16 * 1024 * 1024) child.kill();
        });
        child.stderr.on("data", chunk => {
            stderr += chunk;
            if (stderr.length > 16 * 1024 * 1024) child.kill();
        });
        child.once("error", error => {
            clearTimeout(timer);
            reject(error);
        });
        child.once("close", status => {
            clearTimeout(timer);
            resolve({ status, stdout, stderr });
        });
    });
}
