import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-ui-host-"));
const runnerOutput = join(temporaryDirectory, "flash-ui-host.test.mjs");
const browserOutput = join(temporaryDirectory, "flash-ui-host.browser.js");
const browserHtml = join(temporaryDirectory, "index.html");

try {
    await build({
        entryPoints: [join(root, "tests/flashUiHost/flash-ui-host.runner.ts")],
        outfile: runnerOutput, bundle: true, platform: "node", format: "esm", target: "node18",
        banner: { js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};" },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" }, logLevel: "warning",
    });
    await build({
        entryPoints: [join(root, "tests/flashUiHost/flash-ui-host.browser.ts")],
        outfile: browserOutput, bundle: true, platform: "browser", format: "iife", target: "chrome100",
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" }, logLevel: "warning",
    });
    const result = spawnSync(process.execPath, ["--test", runnerOutput], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Node UI-host tests exited ${result.status}`);

    const chromium = findChromium();
    if (!chromium) throw new Error("Chromium was not found. Set CHROMIUM_PATH to a Chrome or Chromium executable.");
    await writeFile(browserHtml,
        "<!doctype html><meta charset=utf-8><title>Flash UI host browser gate</title><body><script>addEventListener('error',event=>document.body.dataset.bootstrapError=event.message)</script><script src=flash-ui-host.browser.js></script></body>",
        "utf8");
    const payload = await runChromiumGate(chromium, browserHtml, temporaryDirectory);
    assert.equal(payload.syntheticContextIgnored, true);
    assert.equal(payload.programmaticSelectionIgnored, true);
    assert.equal(payload.duplicateAuthorityRetired, true);
    assert.equal(payload.clipboardAccepted, true, payload.clipboardError);
    assert.equal(payload.accessibilitySuccessorPreserved, true);
    assert.equal(payload.accessibilityBaselineRestored, true);
    assert.equal(payload.mouseBrowserProjection, true);
    assert.equal(payload.keyboardProducerTeardown, true);
    assert.equal(payload.syntheticKeyboardIgnored, true);
    assert.equal(payload.clipboardFailClosedOutsideGesture, true);
    assert.equal(payload.reentrantOpen, false);
    assert.equal(payload.forgedOpen, false);
    assert.equal(payload.structuralOpen, false);
    assert.equal(payload.primaryOpen, false);
    assert.equal(payload.popupCount, 0);
    assert.equal(payload.selectionFocusRestored, true);
    assert.deepEqual(payload.trustedDefaultStates, [true, false]);
    assert.deepEqual(payload.trustedKeyboardDefaultStates, [true]);
    assert.ok(payload.route.includes("item:true:true:true"));
    assert.ok(payload.route.includes("structural-default:false"));
    console.log("Flash UI-host Chromium gate passed");
    console.log(JSON.stringify(payload));
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

async function runChromiumGate(chromium, html, temporaryDirectory) {
    const port = await availablePort();
    const url = `file:///${html.replaceAll("\\", "/")}`;
    const browser = spawn(chromium, [
        "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
        "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-dev-shm-usage",
        "--allow-file-access-from-files", `--remote-debugging-port=${port}`, "--remote-allow-origins=*",
        `--user-data-dir=${join(temporaryDirectory, "chromium-profile")}`, url,
    ], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", chunk => { stderr += chunk; });
    let client;
    try {
        const page = await waitForPage(port, url, browser, () => stderr);
        client = await connectCdp(page.webSocketDebuggerUrl);
        await client.send("Runtime.enable");
        try { await client.waitFor("globalThis.__flashUiHostReady === true"); }
        catch (error) {
            const diagnostics = await client.evaluate(`({ href: location.href,
                error: document.body?.dataset.bootstrapError ?? null,
                body: document.body?.innerText?.slice(0, 1000) ?? null })`);
            throw new Error(`${error.message}\nBrowser diagnostics: ${JSON.stringify(diagnostics)}`);
        }

        await client.mouse(30, 30, "right");
        await client.waitFor("globalThis.__flashUiHostTest.primaryHost.open === true");
        let snapshot = await client.evaluate(`({
            firstOpen: globalThis.__flashUiHostTest.firstHost.open,
            primaryOpen: globalThis.__flashUiHostTest.primaryHost.open,
            popupCount: document.querySelectorAll('[data-flash-context-menu=true]').length,
            trustedDefault: globalThis.__flashUiHostTest.state.trustedDefaultStates[0]
        })`);
        assert.deepEqual(snapshot, { firstOpen: false, primaryOpen: true, popupCount: 1, trustedDefault: true });

        await client.evaluate("globalThis.__flashUiHostTest.programmaticSelection()");
        assert.equal(await client.evaluate("globalThis.__flashUiHostTest.state.programmaticSelectionIgnored"), true);
        const button = await client.evaluate(`(() => {
            const buttons = [...document.querySelectorAll('[data-flash-context-menu=true] button:not(:disabled)')];
            const rect = buttons.at(-1).getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        await client.mouse(button.x, button.y, "left");
        await client.waitFor("globalThis.__flashUiHostTest.primaryHost.open === false");

        await client.mouse(30, 120, "right");
        await client.waitFor("globalThis.__flashUiHostTest.reentrantHost.open === false");
        assert.equal(await client.evaluate("document.querySelectorAll('[data-flash-context-menu=true]').length"), 0);

        await client.mouse(30, 210, "right");
        assert.equal(await client.evaluate("document.querySelectorAll('[data-flash-context-menu=true]').length"), 0);

        await client.mouse(30, 300, "right");
        assert.equal(await client.evaluate("document.querySelectorAll('[data-flash-context-menu=true]').length"), 0);

        await client.evaluate("globalThis.__flashUiHostTest.disposeSelectionRestore.focus()");
        await client.evaluate("globalThis.__flashUiHostTest.armDisposeSelection()");
        await client.mouse(30, 390, "right");
        await client.waitFor("globalThis.__flashUiHostTest.disposeSelectionHost.open === true");
        let selectionButton = await client.evaluate(`(() => {
            const rect = document.querySelector('[data-flash-context-menu=true] button:not(:disabled)').getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        await client.mouse(selectionButton.x, selectionButton.y, "left");
        await client.waitFor("globalThis.__flashUiHostTest.disposeSelectionHost.open === false");
        assert.equal(await client.evaluate("globalThis.__flashUiHostTest.state.disposeSelectionDispatches"), 0);

        await client.evaluate("globalThis.__flashUiHostTest.successorSelectionRestore.focus()");
        await client.evaluate("globalThis.__flashUiHostTest.armSuccessorSelection()");
        await client.mouse(30, 480, "right");
        await client.waitFor("globalThis.__flashUiHostTest.predecessorSelectionHost.open === true");
        selectionButton = await client.evaluate(`(() => {
            const rect = document.querySelector('[data-flash-context-menu=true] button:not(:disabled)').getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        await client.mouse(selectionButton.x, selectionButton.y, "left");
        await client.waitFor("globalThis.__flashUiHostTest.state.successorInstalled === true");
        assert.equal(await client.evaluate("globalThis.__flashUiHostTest.state.successorSelectionDispatches"), 0);
        await client.mouse(30, 480, "right");
        await client.waitFor("globalThis.__flashUiHostTest.successorSelectionOpen === true");
        await client.key("Escape", "Escape", 27);
        await client.waitFor("globalThis.__flashUiHostTest.successorSelectionOpen === false");

        await client.evaluate("document.querySelector('canvas').focus()");
        await client.key("ContextMenu", "ContextMenu", 93);
        await client.waitFor("globalThis.__flashUiHostTest.primaryHost.open === true");
        await client.key("Escape", "Escape", 27);
        await client.waitFor("globalThis.__flashUiHostTest.primaryHost.open === false");

        await client.evaluate("globalThis.__flashUiHostTest.disposePrimary()");
        await client.mouse(30, 30, "right");
        snapshot = await client.evaluate("globalThis.__flashUiHostTest.finish()");
        return snapshot;
    } finally {
        client?.close();
        if (!browser.killed) {
            const exited = new Promise(resolvePromise => browser.once("exit", resolvePromise));
            browser.kill();
            await Promise.race([exited, new Promise(resolvePromise => setTimeout(resolvePromise, 3000))]);
        }
    }
}

async function availablePort() {
    const server = createServer();
    await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise(resolvePromise => server.close(resolvePromise));
    if (!port) throw new Error("Could not reserve a Chromium debugging port");
    return port;
}

async function waitForPage(port, expectedUrl, browser, readStderr) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (browser.exitCode !== null)
            throw new Error(`Chromium exited ${browser.exitCode} before CDP became ready:\n${readStderr()}`);
        try {
            const pages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
            const page = pages.find(candidate => candidate.type === "page" && candidate.url === expectedUrl)
                ?? pages.find(candidate => candidate.type === "page");
            if (page?.webSocketDebuggerUrl) return page;
        } catch { /* Chromium has not opened its debugging socket yet. */ }
        await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
    }
    throw new Error(`Timed out waiting for Chromium CDP page:\n${readStderr()}`);
}

async function connectCdp(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
        socket.addEventListener("open", resolvePromise, { once: true });
        socket.addEventListener("error", reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", event => {
        const message = JSON.parse(String(event.data));
        if (!message.id) return;
        const operation = pending.get(message.id);
        if (!operation) return;
        pending.delete(message.id);
        if (message.error) operation.reject(new Error(message.error.message));
        else operation.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolvePromise, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
        return response.result.value;
    };
    return {
        send,
        evaluate,
        async waitFor(expression) {
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                if (await evaluate(`Boolean(${expression})`)) return;
                await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
            }
            throw new Error(`Timed out waiting for browser expression: ${expression}`);
        },
        async mouse(x, y, button) {
            await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
        },
        async key(key, code, virtualKeyCode) {
            await send("Input.dispatchKeyEvent", { type: "keyDown", key, code,
                windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
            await send("Input.dispatchKeyEvent", { type: "keyUp", key, code,
                windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
        },
        close() { socket.close(); },
    };
}
