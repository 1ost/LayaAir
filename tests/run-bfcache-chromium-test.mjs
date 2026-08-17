import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineBundlePath = resolve(root, "build/libs/laya.core.js");
const driverBundlePath = resolve(root, "build/libs/laya.webgl_2D.js");
const chromiumPath = findChromium();
const TIMEOUT = Object.freeze({
    fetch: 5000,
    cdpConnect: 5000,
    cdpCommand: 5000,
    navigation: 20000,
    debugPort: 15000,
    browserExit: 5000,
    processCommand: 5000,
    httpClose: 5000,
    adversary: 50
});

if (!globalThis.WebSocket)
    throw new Error("This gate requires a Node.js runtime with the standard WebSocket client (Node 22 or newer).");
if (!existsSync(engineBundlePath) || !existsSync(driverBundlePath))
    throw new Error("Missing LayaAir browser bundles. Run `node scripts/buildEngine.mjs --bundles=core,webgl_2D --strict-diagnostics --skip-declarations` before this gate.");
if (!chromiumPath)
    throw new Error("Chromium was not found. Set CHROMIUM_PATH to a Chrome or Chromium executable.");

const engineBundle = readFileSync(engineBundlePath);
const driverBundle = readFileSync(driverBundlePath);
const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/laya.core.js") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        response.end(engineBundle);
    }
    else if (path === "/laya.webgl_2D.js") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        response.end(driverBundle);
    }
    else if (path === "/a") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderPageA());
    }
    else if (path === "/b") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><meta charset=utf-8><title>BFCache destination</title>");
    }
    else if (path === "/hang") {
        // Intentionally unanswered for the bounded-fetch adversary check.
    }
    else {
        response.writeHead(404);
        response.end();
    }
});

let chromiumStderr = "";

async function main() {
    const profilePath = await mkdtemp(join(tmpdir(), "laya-bfcache-chromium-"));
    let chromium;
    let cdp;
    const launchError = { value: null };
    let browserExited = true;
    let failure;

    try {
        await listen(server, TIMEOUT.httpClose);
        const address = server.address();
        const origin = `http://127.0.0.1:${address.port}`;
        await runFailurePathAdversary(origin);

        chromiumStderr = "";
        chromium = spawn(chromiumPath, [
            "--headless=new",
            "--remote-debugging-port=0",
            `--user-data-dir=${profilePath}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-extensions",
            "--disable-dev-shm-usage",
            "--enable-unsafe-swiftshader",
            "about:blank"
        ], { stdio: ["ignore", "ignore", "pipe"] });
        chromium.on("error", error => launchError.value ||= error);
        browserExited = false;
        chromium.stderr.setEncoding("utf8");
        chromium.stderr.on("data", chunk => chromiumStderr = (chromiumStderr + chunk).slice(-12000));

        const debugPort = await readDebugPort(profilePath, chromium, launchError);
        const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
        const target = await fetchJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(origin + "/a")}`, {
            method: "PUT"
        });

        cdp = await CDPClient.connect(target.webSocketDebuggerUrl, TIMEOUT.cdpConnect);
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        const notRestored = [];
        cdp.on("Page.backForwardCacheNotUsed", event => notRestored.push(event));

        await waitForExpression(cdp, "window.__bfcacheGate?.ready === true || !!window.__bfcacheGate?.error");
        const initError = await evaluate(cdp, "window.__bfcacheGate.error || null");
        assert.equal(initError, null, `LayaAir failed to initialize in Chromium:\n${initError}`);
        const bootId = await evaluate(cdp, "window.__bfcacheGate.bootId");

        await roundTrip(cdp, origin);
        const automatic = await snapshot(cdp);
        assert.equal(automatic.bootId, bootId, bfcacheFailure(version, notRestored, "The page was recreated after automatic lifecycle restore."));
        assert.deepEqual(automatic.events.slice(-2).map(event => [event.type, event.persisted]), [
            ["pagehide", true],
            ["pageshow", true]
        ], bfcacheFailure(version, notRestored, "Chromium did not report a persisted BFCache round trip."));
        assert.equal(automatic.paused, false);
        assert.deepEqual(automatic.resumeMarks, { system: 1, physics: 1, main: 1 });

        await evaluate(cdp, "Laya.Render.paused = true");
        await roundTrip(cdp, origin);
        const manual = await snapshot(cdp);
        assert.equal(manual.bootId, bootId, bfcacheFailure(version, notRestored, "The page was recreated during the manual-pause round trip."));
        assert.deepEqual(manual.events.slice(-2).map(event => [event.type, event.persisted]), [
            ["pagehide", true],
            ["pageshow", true]
        ], bfcacheFailure(version, notRestored, "The manual-pause round trip did not use BFCache."));
        assert.equal(manual.paused, true, "pageshow must not clear an application-owned Render pause");
        assert.deepEqual(manual.resumeMarks, { system: 1, physics: 1, main: 1 });

        await evaluate(cdp, "Laya.Render.paused = false");
        const resumed = await snapshot(cdp);
        assert.equal(resumed.paused, false);
        assert.deepEqual(resumed.resumeMarks, { system: 2, physics: 2, main: 2 });

        console.log(`Chromium BFCache lifecycle tests passed (${version.Browser})`);
    }
    catch (error) {
        failure = error;
    }

    const cleanupFailures = [];
    if (chromium) {
        try {
            await terminateChromium(chromium, cdp);
            browserExited = true;
        }
        catch (error) {
            cleanupFailures.push(error);
        }
    }
    cdp?.close();
    try {
        await closeServer(server, TIMEOUT.httpClose);
    }
    catch (error) {
        cleanupFailures.push(error);
    }
    try {
        await removeProfileAfterConfirmedExit(profilePath, browserExited);
    }
    catch (error) {
        cleanupFailures.push(error);
    }

    if (failure && cleanupFailures.length)
        throw new AggregateError([failure, ...cleanupFailures], "BFCache gate failed and cleanup was incomplete");
    if (failure)
        throw failure;
    if (cleanupFailures.length)
        throw new AggregateError(cleanupFailures, "BFCache gate cleanup failed");
}

async function roundTrip(client, origin) {
    await client.send("Page.navigate", { url: origin + "/b" });
    await waitForExpression(client, "location.pathname === '/b'");

    const history = await client.send("Page.getNavigationHistory");
    assert.ok(history.currentIndex > 0, "Chromium navigation history has no entry to restore");
    const previous = history.entries[history.currentIndex - 1];
    await client.send("Page.navigateToHistoryEntry", { entryId: previous.id });
    await waitForExpression(client, "location.pathname === '/a' && window.__bfcacheGate?.ready === true");
}

async function snapshot(client) {
    return evaluate(client, `({
        bootId: window.__bfcacheGate.bootId,
        events: window.__bfcacheGate.events,
        paused: Laya.Render.paused,
        resumeMarks: window.__bfcacheGate.resumeMarks
    })`);
}

async function evaluate(client, expression, timeout = TIMEOUT.cdpCommand) {
    const result = await client.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
    }, timeout);
    if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
}

async function waitForExpression(client, expression, timeout = TIMEOUT.navigation) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const remaining = Math.max(1, deadline - Date.now());
            if (await evaluate(client, expression, Math.min(TIMEOUT.cdpCommand, remaining)))
                return;
        }
        catch (error) {
            lastError = error;
        }
        await delay(50);
    }
    throw new Error(`Timed out waiting for browser expression: ${expression}${lastError ? `\n${lastError}` : ""}`);
}

async function fetchJson(url, options = {}, timeout = TIMEOUT.fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`HTTP request timed out after ${timeout}ms: ${url}`)), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok)
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
        return await response.json();
    }
    catch (error) {
        if (controller.signal.aborted)
            throw new Error(`HTTP request timed out after ${timeout}ms: ${url}`, { cause: error });
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}

function bfcacheFailure(version, events, message) {
    const explanations = events.map(event => event.notRestoredExplanationsTree || event.notRestoredExplanations || event);
    return `${message}\nBrowser: ${version.Browser}\nPage.backForwardCacheNotUsed: ${JSON.stringify(explanations, null, 2)}`;
}

async function readDebugPort(profile, process, launchError) {
    const portFile = join(profile, "DevToolsActivePort");
    const deadline = Date.now() + TIMEOUT.debugPort;
    while (Date.now() < deadline) {
        if (launchError.value)
            throw new Error(`Chromium failed to launch: ${launchError.value.message}\n${chromiumStderr}`, { cause: launchError.value });
        if (!isProcessAlive(process))
            throw new Error(`Chromium exited before opening DevTools (exit ${process.exitCode}).\n${chromiumStderr}`);
        try {
            const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
            if (port)
                return Number(port);
        }
        catch {
        }
        await delay(50);
    }
    throw new Error(`Chromium did not create DevToolsActivePort.\n${chromiumStderr}`);
}

class CDPClient {
    static async connect(url, timeout = TIMEOUT.cdpConnect) {
        const socket = new WebSocket(url);
        const client = new CDPClient(socket);
        await client.waitForOpen(timeout);
        return client;
    }

    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
        this.openWaiters = [];
        this.opened = socket.readyState === WebSocket.OPEN;
        this.terminalError = null;
        socket.addEventListener("open", () => {
            this.opened = true;
            for (const waiter of this.openWaiters) {
                clearTimeout(waiter.timer);
                waiter.resolve();
            }
            this.openWaiters.length = 0;
        });
        socket.addEventListener("message", message => this.handleMessage(message));
        socket.addEventListener("error", event => this.terminate(new Error(`CDP WebSocket error${event.message ? `: ${event.message}` : ""}`)));
        socket.addEventListener("close", event => this.terminate(new Error(`CDP WebSocket closed (code ${event.code}${event.reason ? `, ${event.reason}` : ""})`)));
    }

    waitForOpen(timeout) {
        if (this.opened)
            return Promise.resolve();
        if (this.terminalError)
            return Promise.reject(this.terminalError);
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, timer: null };
            waiter.timer = setTimeout(() => {
                const index = this.openWaiters.indexOf(waiter);
                if (index !== -1)
                    this.openWaiters.splice(index, 1);
                const error = new Error(`CDP WebSocket connect timed out after ${timeout}ms`);
                reject(error);
                this.close(error);
            }, timeout);
            this.openWaiters.push(waiter);
        });
    }

    handleMessage(message) {
        let packet;
        try {
            packet = JSON.parse(message.data);
        }
        catch (error) {
            this.terminate(new Error("CDP returned malformed JSON", { cause: error }));
            return;
        }
        if (packet.id) {
            const pending = this.pending.get(packet.id);
            if (!pending)
                return;
            this.pending.delete(packet.id);
            clearTimeout(pending.timer);
            if (packet.error)
                pending.reject(new Error(`${packet.error.message} (${packet.error.code})`));
            else
                pending.resolve(packet.result);
        }
        else {
            for (const listener of this.listeners.get(packet.method) || [])
                listener(packet.params);
        }
    }

    send(method, params = {}, timeout = TIMEOUT.cdpCommand) {
        if (this.terminalError)
            return Promise.reject(this.terminalError);
        if (this.socket.readyState !== WebSocket.OPEN)
            return Promise.reject(new Error(`Cannot send CDP ${method}: WebSocket is not open`));

        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!this.pending.delete(id))
                    return;
                reject(new Error(`CDP command timed out after ${timeout}ms: ${method}`));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer, method });
            try {
                this.socket.send(JSON.stringify({ id, method, params }));
            }
            catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    on(method, listener) {
        let listeners = this.listeners.get(method);
        if (!listeners)
            this.listeners.set(method, listeners = []);
        listeners.push(listener);
    }

    terminate(error) {
        if (this.terminalError)
            return;
        this.terminalError = error;
        for (const waiter of this.openWaiters) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
        this.openWaiters.length = 0;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }

    close(reason = new Error("CDP client closed")) {
        this.terminate(reason);
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
            this.socket.close();
    }
}

class AdversarySocket extends EventTarget {
    constructor(readyState = WebSocket.OPEN) {
        super();
        this.readyState = readyState;
    }

    send() {
    }

    close() {
        if (this.readyState === WebSocket.CLOSED)
            return;
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code: 1000, reason: "adversary close" }));
    }

    failWithClose() {
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code: 1006, reason: "adversary disconnect" }));
    }

    failWithError() {
        this.dispatchEvent(new Event("error"));
    }
}

class AdversaryProcess extends EventEmitter {
    constructor() {
        super();
        this.pid = 42424242;
        this.exitCode = null;
        this.signalCode = null;
        this.alive = true;
        this.killSignals = [];
    }

    isAlive() {
        return this.alive;
    }

    kill(signal = "default") {
        this.killSignals.push(signal);
        return true;
    }
}

async function runFailurePathAdversary(origin) {
    await assert.rejects(
        fetchJson(origin + "/hang", {}, TIMEOUT.adversary),
        /HTTP request timed out/,
        "bounded fetch must reject a server that never responds"
    );

    const connectSocket = new AdversarySocket(WebSocket.CONNECTING);
    const connectClient = new CDPClient(connectSocket);
    await assert.rejects(
        connectClient.waitForOpen(TIMEOUT.adversary),
        /CDP WebSocket connect timed out/,
        "a CDP transport that never opens must time out"
    );
    assert.equal(connectClient.pending.size, 0);

    const timeoutSocket = new AdversarySocket();
    const timeoutClient = new CDPClient(timeoutSocket);
    await assert.rejects(
        timeoutClient.send("Adversary.neverReplies", {}, TIMEOUT.adversary),
        /CDP command timed out/,
        "an unanswered CDP command must time out"
    );
    assert.equal(timeoutClient.pending.size, 0);
    timeoutClient.close();

    const closeSocket = new AdversarySocket();
    const closeClient = new CDPClient(closeSocket);
    const closePending = closeClient.send("Adversary.close", {}, 1000);
    closeSocket.failWithClose();
    await assert.rejects(closePending, /CDP WebSocket closed/);
    assert.equal(closeClient.pending.size, 0);

    const errorSocket = new AdversarySocket();
    const errorClient = new CDPClient(errorSocket);
    const errorPending = errorClient.send("Adversary.error", {}, 1000);
    errorSocket.failWithError();
    await assert.rejects(errorPending, /CDP WebSocket error/);
    assert.equal(errorClient.pending.size, 0);
    errorClient.close();

    const liveProcess = new AdversaryProcess();
    let forcedEscalations = 0;
    const termination = terminateChromium(liveProcess, null, {
        exitTimeout: TIMEOUT.adversary,
        forceTerminate: async () => forcedEscalations++
    });
    setTimeout(() => liveProcess.emit("error", new Error("adversary process error while alive")), 0);
    await assert.rejects(
        termination,
        /still alive after graceful close, terminate, and forced escalation/,
        "a child error while the process is alive must not be accepted as exit"
    );
    assert.deepEqual(liveProcess.killSignals, ["default"]);
    assert.equal(forcedEscalations, 1);

    let removedUnconfirmedProfile = false;
    await assert.rejects(
        removeProfileAfterConfirmedExit("adversary-profile", false, async () => removedUnconfirmedProfile = true),
        /exit was not confirmed; profile retained/,
        "an unconfirmed process exit must retain the browser profile"
    );
    assert.equal(removedUnconfirmedProfile, false);
}

async function terminateChromium(processHandle, client, options = {}) {
    const exitTimeout = options.exitTimeout ?? TIMEOUT.browserExit;
    const forceTerminate = options.forceTerminate ?? forceTerminateProcess;
    if (!isProcessAlive(processHandle))
        return;

    if (client && !client.terminalError) {
        try {
            await client.send("Browser.close", {}, TIMEOUT.cdpCommand);
        }
        catch {
            // Browser.close commonly closes the transport before acknowledging.
        }
    }
    if (await waitForProcessExit(processHandle, exitTimeout))
        return;

    try {
        processHandle.kill();
    }
    catch {
    }
    if (await waitForProcessExit(processHandle, exitTimeout))
        return;

    await forceTerminate(processHandle);
    if (await waitForProcessExit(processHandle, exitTimeout))
        return;

    throw new Error(`Chromium process ${processHandle.pid} is still alive after graceful close, terminate, and forced escalation`);
}

async function forceTerminateProcess(processHandle) {
    if (process.platform === "win32") {
        await runBoundedProcess("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], TIMEOUT.processCommand);
    }
    else {
        try {
            processHandle.kill("SIGKILL");
        }
        catch {
        }
    }
}

function isProcessAlive(processHandle) {
    if (typeof processHandle?.isAlive === "function")
        return processHandle.isAlive();
    if (!processHandle || processHandle.exitCode != null || processHandle.signalCode != null || !processHandle.pid)
        return false;
    try {
        process.kill(processHandle.pid, 0);
        return true;
    }
    catch {
        return false;
    }
}

function waitForProcessExit(processHandle, timeout) {
    if (!isProcessAlive(processHandle))
        return Promise.resolve(true);
    return new Promise(resolve => {
        let finished = false;
        const complete = value => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timer);
            processHandle.off("exit", onExit);
            processHandle.off("error", onError);
            resolve(value);
        };
        const onExit = () => complete(true);
        const onError = () => complete(!isProcessAlive(processHandle));
        const timer = setTimeout(() => complete(!isProcessAlive(processHandle)), timeout);
        processHandle.once("exit", onExit);
        processHandle.once("error", onError);
    });
}

async function removeProfileAfterConfirmedExit(profilePath, browserExited, remover = rm) {
    if (!browserExited)
        throw new Error(`Chromium exit was not confirmed; profile retained at ${profilePath}`);
    try {
        await remover(profilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    catch (error) {
        throw new Error(`Failed to remove confirmed-stopped Chromium profile ${profilePath}: ${error.message}`, { cause: error });
    }
}

function runBoundedProcess(command, args, timeout) {
    return new Promise(resolve => {
        const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
        let finished = false;
        const complete = result => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timer);
            resolve(result);
        };
        child.once("exit", code => complete(code));
        child.once("error", () => complete(null));
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch {
            }
            complete(null);
        }, timeout);
    });
}

function findChromium() {
    const candidates = [
        process.env.CHROMIUM_PATH,
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ];
    return candidates.find(candidate => candidate && existsSync(candidate));
}

function listen(httpServer, timeout) {
    return new Promise((resolve, reject) => {
        let finished = false;
        const complete = (error) => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timer);
            httpServer.off("error", onError);
            httpServer.off("listening", onListening);
            if (error)
                reject(error);
            else
                resolve();
        };
        const onError = error => complete(error);
        const onListening = () => complete();
        const timer = setTimeout(() => {
            httpServer.closeAllConnections?.();
            httpServer.close();
            complete(new Error(`HTTP server listen timed out after ${timeout}ms`));
        }, timeout);
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(0, "127.0.0.1");
    });
}

function closeServer(httpServer, timeout) {
    if (!httpServer.listening)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        let finished = false;
        const complete = error => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timer);
            if (error)
                reject(error);
            else
                resolve();
        };
        const timer = setTimeout(() => {
            httpServer.closeAllConnections?.();
            complete(new Error(`HTTP server close timed out after ${timeout}ms`));
        }, timeout);
        httpServer.close(error => complete(error));
        httpServer.closeIdleConnections?.();
        httpServer.closeAllConnections?.();
    });
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function renderPageA() {
    return `<!doctype html>
<meta charset="utf-8">
<title>LayaAir BFCache lifecycle gate</title>
<body>
<script>
window.__bfcacheGate = {
    bootId: crypto.randomUUID(),
    ready: false,
    events: [],
    resumeMarks: { system: 0, physics: 0, main: 0 }
};
</script>
<script src="/laya.core.js"></script>
<script src="/laya.webgl_2D.js"></script>
<script>
(async () => {
    await Laya.Laya.init(64, 64);
    const gate = window.__bfcacheGate;
    const timers = [
        ["system", Laya.Laya.systemTimer],
        ["physics", Laya.Laya.physicsTimer],
        ["main", Laya.Laya.timer]
    ];
    for (const [name, timer] of timers) {
        const markResumed = timer._markResumed.bind(timer);
        timer._markResumed = () => {
            gate.resumeMarks[name]++;
            markResumed();
        };
    }
    Laya.Laya.stage.on(Laya.Event.PAGE_HIDE, persisted => gate.events.push({
        type: "pagehide",
        persisted,
        paused: Laya.Render.paused
    }));
    Laya.Laya.stage.on(Laya.Event.PAGE_SHOW, persisted => gate.events.push({
        type: "pageshow",
        persisted,
        paused: Laya.Render.paused
    }));
    gate.ready = true;
})().catch(error => window.__bfcacheGate.error = error.stack || String(error));
</script>`;
}

await main();
