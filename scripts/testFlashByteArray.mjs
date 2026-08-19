import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-byte-array-tests-"));
const runnerOutput = join(temporaryDirectory, "flash-byte-array.test.mjs");

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
        entryPoints: [join(root, "tests/flashByteArray/browser-entry.ts")],
        outfile: join(temporaryDirectory, "browser-entry.js"),
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2019",
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        logLevel: "warning"
    });
    const result = spawnSync(process.execPath, ["--test", runnerOutput], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
