import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-authored-repeated-placement-runtime-"));
const bundleRoot = join(temporaryDirectory, "bundle");
const output = join(temporaryDirectory, "authored-repeated-placement-runtime.test.mjs");

try {
    const fixture = spawnSync(process.execPath, [
        "--max-old-space-size=256",
        join(root, "tests/authoredRepeatedPlacement/run.cjs"), "--emit-runtime-bundle", bundleRoot,
    ], { cwd: root, stdio: "inherit", timeout: 30_000 });
    if (fixture.error) throw fixture.error;
    if (fixture.status !== 0) throw new Error(`Repeated-placement fixture failed with exit ${fixture.status ?? "unknown"}.`);
    await build({
        entryPoints: [join(root, "tests/authoredRepeatedPlacement/authored-repeated-placement-runtime.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: { js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};" },
        loader: { ".glsl": "text", ".vs": "text", ".fs": "text" },
        sourcemap: false,
        logLevel: "warning",
    });
    const result = spawnSync(process.execPath, [
        "--max-old-space-size=384",
        "--test-concurrency=1",
        "--test",
        output,
    ], {
        cwd: root,
        stdio: "inherit",
        timeout: 120_000,
        env: {
            ...process.env,
            AUTHORED_REPEATED_PLACEMENT_HIERARCHY: join(bundleRoot, "mc-sell-fixture.lh"),
        },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
