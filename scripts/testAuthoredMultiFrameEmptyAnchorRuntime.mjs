import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-authored-empty-anchor-runtime-"));
const bundleRoot = join(temporaryDirectory, "bundle");
const output = join(temporaryDirectory, "authored-empty-anchor-runtime.test.mjs");

try {
    const fixture = spawnSync(process.execPath, [
        join(root, "tests/authoredMultiFrameEmptyAnchor/run.cjs"),
        "--emit-runtime-bundle",
        bundleRoot,
    ], { cwd: root, stdio: "inherit", timeout: 30_000 });
    if (fixture.error) throw fixture.error;
    if (fixture.status !== 0)
        throw new Error(`Authored empty-anchor emitter fixture failed with exit ${fixture.status ?? "unknown"}.`);

    await build({
        entryPoints: [join(root, "tests/authoredMultiFrameEmptyAnchor/authored-multiframe-empty-anchor-runtime.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: { js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};" },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        sourcemap: "inline",
        logLevel: "warning",
    });
    const result = spawnSync(process.execPath, ["--max-old-space-size=512", "--test", output], {
        cwd: root,
        stdio: "inherit",
        timeout: 30_000,
        env: {
            ...process.env,
            AUTHORED_EMPTY_ANCHOR_HIERARCHY: join(bundleRoot, "empty-anchor.lh"),
            AUTHORED_EMPTY_ANCHOR_ROOT_TIMELINE: join(bundleRoot, "empty-anchor.mc"),
            AUTHORED_EMPTY_ANCHOR_NESTED_TIMELINE: join(bundleRoot, "timelines/nested-1.mc"),
        },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
