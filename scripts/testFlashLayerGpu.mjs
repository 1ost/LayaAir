import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
const chrome = [process.env.CHROMIUM_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")].filter(Boolean).map(value => resolve(value)).find(existsSync);
if (!chrome) throw new Error("Chromium was not found");
const dir = await mkdtemp(join(tmpdir(), "laya-flash-layer-gpu-"));
try {
  await build({ entryPoints:[join(root,"tests/flashDisplayObject/flash-layer.gpu.ts")], outfile:join(dir,"gate.js"), bundle:true, platform:"browser", format:"iife", target:"chrome100", loader:{".glsl":"text",".vs":"text",".fs":"text"} });
  await writeFile(join(dir,"index.html"), "<!doctype html><body><script src=gate.js></script>");
  const r=spawnSync(chrome,["--headless=new","--disable-gpu-sandbox","--enable-unsafe-swiftshader","--allow-file-access-from-files","--virtual-time-budget=10000","--dump-dom",`file:///${join(dir,"index.html").replaceAll("\\","/")}`],{encoding:"utf8",timeout:60000,maxBuffer:8*1024*1024});
  assert.equal(r.status,0,r.stderr); const m=r.stdout.match(/<pre id="flash-layer-gpu-result">([^<]+)<\/pre>/); assert.ok(m,r.stdout.slice(-2000));
  const payload=JSON.parse(m[1].replaceAll("&quot;",'"').replaceAll("&amp;","&")); assert.equal(payload.ok,true,payload.error); console.log(JSON.stringify(payload.result));
} finally { await rm(dir,{recursive:true,force:true}); }
