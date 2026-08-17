import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "layaair-authored-bridge-tests-"));
const output = join(temporaryDirectory, "authored-bridge.test.mjs");

try {
    await build({
        entryPoints: [join(root, "tests/extensions/authoredContentBridge/authored-bridge.runner.ts")],
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node18",
        banner: {
            js: "globalThis.window = globalThis.window ?? globalThis; globalThis.document = globalThis.document ?? {};"
        },
        loader: {
            ".glsl": "text",
            ".vs": "text",
            ".fs": "text"
        },
        sourcemap: "inline",
        logLevel: "warning"
    });

    const result = spawnSync(process.execPath, ["--test", output], {
        cwd: root,
        stdio: "inherit"
    });
    if (result.error)
        throw result.error;
    process.exitCode = result.status ?? 1;
    if (process.exitCode === 0) {
        const files = [
            "src/layaAir/flash/events/FlashEventRouter.ts",
            "src/layaAir/flash/display/MovieClip.ts",
            "src/layaAir/flash/display/SimpleButton.ts",
            "src/layaAir/flash/text/TextField.ts",
            "src/extensions/authoredContent/runtime/AuthoredCodeBindings.ts",
            "src/extensions/authoredContent/runtime/LayaAuthoredBindingHost.ts"
        ];
        const combined = (await Promise.all(files.map(file => readFile(join(root, file), "utf8")))).join("\n");
        for (const forbidden of ["createSourceApi", "transpileAs3Subset", "@bleach/flash-compat", "eval(", "new Function"])
            if (combined.includes(forbidden)) throw new Error(`forbidden canonical runtime surface: ${forbidden}`);
    }
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
