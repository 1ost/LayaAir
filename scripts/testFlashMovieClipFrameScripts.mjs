import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-movie-clip-frame-scripts-"));
const output = join(temporaryDirectory, "flash-movie-clip-frame-scripts.test.mjs");

try {
    await build({
        entryPoints: [join(root, "tests/flashMovieClipFrameScripts/flash-movie-clip-frame-scripts.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: {
            js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};"
        },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        sourcemap: "inline",
        logLevel: "warning",
    });
    const result = spawnSync(process.execPath,
        ["--max-old-space-size=512", "--test", output],
        { cwd: root, stdio: "inherit", timeout: 30_000 });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
