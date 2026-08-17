import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const stubs = {
    "event-dispatcher": `
        export class EventDispatcher {
            constructor() { this.listeners = new Map(); }
            on(type, caller, listener) {
                if (listener == null) listener = caller;
                let listeners = this.listeners.get(type);
                if (!listeners) this.listeners.set(type, listeners = []);
                listeners.push(listener);
                return this;
            }
            event(type, data) {
                for (const listener of this.listeners.get(type) || []) listener(data);
            }
        }
    `,
    "web-socket": "export class _WebSocket {}",
    "web-socket-interface": "export {};",
    "browser": `
        export const Browser = {
            PLATFORM_PC: 0,
            PLATFORM_ANDROID: 1,
            PLATFORM_IOS: 2,
            document: null,
            window: null,
            onLayaRuntime: false,
            isDomSupported: true
        };
    `,
    "platform-adapters": `
        export const PAL = {
            browser: null,
            g: null,
            register() {}
        };
    `,
    "input-manager": "export const InputManager = { lastMouseTime: 0 };",
    "laya-gl": `
        export const LayaGL = {
            statAgent: {
                startFrameLogic() {},
                endFrameLogic() {}
            }
        };
    `,
    "config": "export const Config = { FPS: 60, fixedFrames: false };",
    "ilaya": `
        const timer = () => ({ resumed: 0, _markResumed() { this.resumed++; }, _syncTimestamp() {} });
        export const ILaya = {
            systemTimer: timer(),
            physicsTimer: timer(),
            timer: timer(),
            stage: { _visible: true, render() {} }
        };
    `,
    "point": "export class Point {}"
};

const stubPlugin = {
    name: "bfcache-test-stubs",
    setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
            const path = args.path.replaceAll("\\\\", "/");
            if (path.endsWith("/EventDispatcher") || path === "../events/EventDispatcher")
                return { path: "event-dispatcher", namespace: "test-stub" };
            if (path.endsWith("/IWebSocket") || path === "../net/IWebSocket")
                return { path: "web-socket-interface", namespace: "test-stub" };
            if (path.endsWith("/WebSocket") || path === "../net/WebSocket")
                return { path: "web-socket", namespace: "test-stub" };
            if (path.endsWith("/Browser") || path === "../utils/Browser")
                return { path: "browser", namespace: "test-stub" };
            if (path.endsWith("/PlatformAdapters") || path.endsWith("./PlatformAdapters"))
                return { path: "platform-adapters", namespace: "test-stub" };
            if (path.endsWith("/InputManager") || path === "../events/InputManager")
                return { path: "input-manager", namespace: "test-stub" };
            if (path.endsWith("/LayaGL") || path === "../layagl/LayaGL")
                return { path: "laya-gl", namespace: "test-stub" };
            if (path.endsWith("/Config") || path === "./../../Config")
                return { path: "config", namespace: "test-stub" };
            if (path.endsWith("/ILaya") || path === "./../../ILaya")
                return { path: "ilaya", namespace: "test-stub" };
            if (path.endsWith("/Point") || path === "../maths/Point")
                return { path: "point", namespace: "test-stub" };
            return null;
        });
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, args => ({
            contents: stubs[args.path],
            loader: "js"
        }));
    }
};

const entry = `
    import assert from "node:assert/strict";
    import { BrowserAdapter } from "./src/layaAir/laya/platform/BrowserAdapter";
    import { Event } from "./src/layaAir/laya/events/Event";
    import { Render } from "./src/layaAir/laya/renders/Render";
    import { Browser } from "./src/layaAir/laya/utils/Browser";
    import { PAL } from "./src/layaAir/laya/platform/PlatformAdapters";
    import { ILaya } from "./src/layaAir/ILaya";

    const windowListeners = new Map();
    const documentListeners = new Map();
    const addListener = map => (type, listener) => {
        let listeners = map.get(type);
        if (!listeners) map.set(type, listeners = []);
        listeners.push(listener);
    };
    const win = {
        devicePixelRatio: 1,
        navigator: { userAgent: "test", platform: "win32" },
        addEventListener: addListener(windowListeners),
        requestAnimationFrame() {},
        setInterval() { return 1; },
        clearInterval() {}
    };
    const head = { appendChild() {} };
    const doc = {
        hidden: false,
        visibilityState: "visible",
        body: { style: {} },
        addEventListener: addListener(documentListeners),
        createElement: () => ({}),
        getElementsByTagName: tag => tag === "head" ? [head] : []
    };
    globalThis.window = win;
    globalThis.document = doc;
    Browser.window = win;
    Browser.document = doc;

    const browser = new BrowserAdapter();
    PAL.browser = browser;
    Render.__init__();

    let pageHidePersisted = null;
    let pageShowPersisted = null;
    browser.on(Event.PAGE_HIDE, value => pageHidePersisted = value);
    browser.on(Event.PAGE_SHOW, value => pageShowPersisted = value);
    const dispatchWindow = (type, persisted) => {
        for (const listener of windowListeners.get(type) || []) listener({ persisted });
    };
    const resumed = () => [ILaya.systemTimer.resumed, ILaya.physicsTimer.resumed, ILaya.timer.resumed];

    assert.equal(Event.PAGE_HIDE, "pagehide");
    assert.equal(Event.PAGE_SHOW, "pageshow");
    assert.equal(Render.paused, false);

    dispatchWindow("pagehide", true);
    assert.equal(pageHidePersisted, true);
    assert.equal(Render.paused, true);
    dispatchWindow("pageshow", true);
    assert.equal(pageShowPersisted, true);
    assert.equal(Render.paused, false);
    assert.deepEqual(resumed(), [1, 1, 1]);

    Render.paused = true;
    dispatchWindow("pagehide", false);
    assert.equal(pageHidePersisted, false);
    dispatchWindow("pageshow", false);
    assert.equal(pageShowPersisted, false);
    assert.equal(Render.paused, true, "pageshow must not override an application pause");
    assert.deepEqual(resumed(), [1, 1, 1]);
    Render.paused = false;
    assert.equal(Render.paused, false);
    assert.deepEqual(resumed(), [2, 2, 2]);

    dispatchWindow("pagehide", true);
    Render.paused = true;
    dispatchWindow("pageshow", true);
    assert.equal(Render.paused, true, "a pause requested while hidden must survive restore");
    Render.paused = false;
    assert.deepEqual(resumed(), [3, 3, 3]);
`;

const result = await build({
    stdin: { contents: entry, loader: "js", resolveDir: root },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [stubPlugin],
    logLevel: "silent"
});
const bundle = result.outputFiles[0].text;
await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);

const stageSource = readFileSync(resolve(root, "src/layaAir/laya/display/Stage.ts"), "utf8");
assert.match(stageSource, /PAL\.browser\.on\(Event\.PAGE_HIDE,[\s\S]*this\.event\(Event\.PAGE_HIDE, persisted\)/);
assert.match(stageSource, /PAL\.browser\.on\(Event\.PAGE_SHOW,[\s\S]*this\.event\(Event\.PAGE_SHOW, persisted\)/);

console.log("BFCache lifecycle tests passed");
