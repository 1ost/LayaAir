import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-reflection-tests-"));

try {
    const output = join(temporaryDirectory, "flash-reflection.test.mjs");
    await build({
        entryPoints: [join(root, "tests/flashReflection/flash-reflection.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        sourcemap: "inline",
        logLevel: "warning",
    });
    const result = spawnSync(process.execPath, ["--test", output], {
        cwd: root,
        stdio: "inherit",
    });
    if (result.error)
        throw result.error;
    assert.equal(result.status, 0, `Node Flash reflection tests exited ${result.status}`);
}
finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
