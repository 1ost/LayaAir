import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const core = join(root, "build/libs/laya.core.js");
const flash = join(root, "build/libs/laya.flash.js");
assert(existsSync(core) && existsSync(flash), "Run npm run build before the Flash host bundle gate");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-system-bundle-"));
const html = join(temporaryDirectory, "index.html");

try {
    const body = `<!doctype html><meta charset=utf-8><body>
<script src="${pathToFileURL(core).href}"></script>
<script src="${pathToFileURL(flash).href}"></script>
<script>
(() => {
  const F = globalThis.LayaFlash;
  const checks = {};
  try { Reflect.construct(F.NativeExternalInterfaceHost, []); checks.directExternal = false; }
  catch { checks.directExternal = true; }
  try { Reflect.construct(F.NativeSystemHost, []); checks.directSystem = false; }
  catch { checks.directSystem = true; }
  try { Reflect.construct(F.NativeExternalInterfaceHost, [], class Fake {}); checks.fakeNewTarget = false; }
  catch { checks.fakeNewTarget = true; }
  try { F.ExternalInterface.call("before"); checks.preinstall = false; }
  catch (error) {
    checks.preinstall = error instanceof F.UnsupportedFlashFeatureError
      && error.feature === "flash.external.ExternalInterface.call";
  }
  class ExternalHost extends F.NativeExternalInterfaceHost {
    constructor() { super(); this.calls = []; }
    call(name, args) { this.calls.push([name, args]); return args.length; }
  }
  class SystemHost extends F.NativeSystemHost {
    constructor() { super(); this.value = null; }
    setClipboard(text) { this.value = text; }
  }
  const malformed = new ExternalHost();
  Object.defineProperty(malformed, "call", { value: null });
  try { F.installNativeExternalInterfaceHost(malformed); checks.malformed = false; }
  catch { checks.malformed = F.ExternalInterface.available === false; }
  const external = new ExternalHost();
  const system = new SystemHost();
  F.installNativeExternalInterfaceHost(external);
  F.installNativeSystemHost(system);
  checks.call = F.ExternalInterface.call("console.log", "ready", 1) === 2;
  try { F.ExternalInterface.call("."); checks.dot = false; } catch { checks.dot = true; }
  try { F.ExternalInterface.call("console.log", { mutable: true }); checks.object = false; }
  catch { checks.object = external.calls.length === 1; }
  F.System.setClipboard("bundle");
  checks.clipboard = system.value === "bundle";
  const illegal = new F.IllegalOperationError("blocked", 17);
  const descriptor = Object.getOwnPropertyDescriptor(illegal, "errorID");
  checks.illegal = illegal.name === "Error" && illegal.toString() === "Error: blocked"
    && descriptor.writable === false && descriptor.configurable === false;
  const marker = document.createElement("pre");
  marker.id = "flash-system-host-bundle-result";
  marker.textContent = JSON.stringify({ ok: Object.values(checks).every(Boolean), checks });
  document.body.appendChild(marker);
})();
</script>`;
    await writeFile(html, body, "utf8");
    const chromium = findChromium();
    if (!chromium) throw new Error("Chromium was not found. Set CHROMIUM_PATH to Chrome or Chromium.");
    const browser = spawnSync(chromium, ["--headless=new", "--no-first-run", "--no-default-browser-check",
        "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
        "--disable-extensions", "--disable-dev-shm-usage", "--allow-file-access-from-files",
        "--virtual-time-budget=5000", "--dump-dom", pathToFileURL(html).href],
    { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (browser.error) throw browser.error;
    assert.equal(browser.status, 0, `Chromium exited ${browser.status}:\n${browser.stderr}`);
    const match = browser.stdout.match(/<pre id="flash-system-host-bundle-result">([^<]*)<\/pre>/);
    assert.ok(match, `Bundle result marker missing:\n${browser.stdout.slice(-4000)}`);
    const payload = JSON.parse(decodeHtml(match[1]));
    assert.equal(payload.ok, true, JSON.stringify(payload.checks));
    console.log("Flash system/host built-bundle Chromium gate passed");
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
