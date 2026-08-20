import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-loader-tests-"));
const output = join(temporaryDirectory, "flash-loader.test.mjs");

try {
    await build({
        entryPoints: [join(root, "tests/flashLoader/flash-loader.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: { js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {}; Object.defineProperty(globalThis, 'navigator', { value: globalThis.navigator ?? {}, configurable: true });" },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        sourcemap: "inline",
        logLevel: "warning"
    });
    const result = spawnSync(process.execPath, ["--test", output], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
