import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = process.env.LAYA_NODE_MODULES
    ? path.resolve(process.env.LAYA_NODE_MODULES)
    : path.join(repository, "node_modules");
const require = createRequire(import.meta.url);
const { build } = require(path.join(nodeModules, "esbuild/lib/main.js"));
const entry = path.join(repository, "tests/extensions/authoredContent/authoredCodeBindings.test.ts");
const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm", target: "node20" });
assert.equal(result.outputFiles.length, 1);
const url = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const fixture = await import(url);
fixture.run();

const runtimeRoot = path.join(repository, "src/extensions/authoredContent/runtime");
const combined = (await Promise.all([
    "AuthoredCodeBindings.ts", "LayaAuthoredBindingHost.ts", "FlashEventRouter.ts"
].map(name => readFile(path.join(runtimeRoot, name), "utf8")))).join("\n");
for (const forbidden of ["@bleach/flash-compat", "avm2", "eval(", "globalThis", "new Function"])
    assert.equal(combined.includes(forbidden), false, `forbidden runtime surface: ${forbidden}`);
const layaHost = await readFile(path.join(runtimeRoot, "LayaAuthoredBindingHost.ts"), "utf8");
for (const required of ["listener.node.on", "listener.node.off", "findNodes(root"])
    assert.ok(layaHost.includes(required), `real Laya host seam missing: ${required}`);
console.log("Authored content code-binding tests passed");
