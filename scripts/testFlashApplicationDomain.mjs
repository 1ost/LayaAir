import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-flash-application-domain-"));

try {
    const output = join(temporaryDirectory, "flash-application-domain.test.mjs");
    await build({
        entryPoints: [join(root, "tests/flashApplicationDomain/flash-application-domain.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: {
            js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};",
        },
        sourcemap: "inline",
        logLevel: "warning",
        loader: {
            ".glsl": "text",
            ".vs": "text",
            ".fs": "text",
        },
    });
    const result = spawnSync(process.execPath, ["--max-old-space-size=512", "--test", output], {
        cwd: root,
        stdio: "inherit",
        timeout: 30_000,
    });
    if (result.error)
        throw result.error;
    assert.equal(result.status, 0, `Node ApplicationDomain tests exited ${result.status}`);
}
finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
