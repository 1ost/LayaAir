import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-text-field-clipping-"));
const output = join(temporaryDirectory, "flash-text-field-clipping.test.mjs");

try {
    await build({
        entryPoints: [join(root, "tests/flashTextFieldClipping/flash-text-field-clipping.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: {
            js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};",
        },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        sourcemap: false,
        logLevel: "warning",
    });
    const result = spawnSync(process.execPath,
        ["--max-old-space-size=384", "--no-enable-source-maps", "--test", output],
        { cwd: root, stdio: "inherit", timeout: 30_000 });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
