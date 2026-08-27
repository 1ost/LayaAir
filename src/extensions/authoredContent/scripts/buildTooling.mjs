import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(extensionRoot, "../../..");
const packageRoot = path.join(repositoryRoot, "build/npm-packages/laya-authored-content");
const dist = path.join(packageRoot, "dist");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");

const providerCommit = await capture("git", ["rev-parse", "HEAD"]);
const providerStatus = await capture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
if (providerStatus)
    throw new Error("Refusing to build @layabox/laya-authored-content from a dirty provider checkout.");
const toolingListing = await capture("git", ["ls-tree", "-r", "--full-tree", "HEAD", "--",
    "package.json",
    "src/extensions/authoredContent/scripts/buildTooling.mjs",
    "src/extensions/authoredContent/tooling",
    "src/extensions/authoredContent/tsconfig.tooling.json",
    "tooling/layaAuthoredContent"]);
const { createHash } = await import("node:crypto");
const toolingSourceSha256 = createHash("sha256").update(`${toolingListing.replace(/\r\n?/g, "\n")}\n`).digest("hex");

await rm(packageRoot, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const shared = {
    bundle: true,
    platform: "node",
    target: "node20",
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    define: { __LAYA_AUTHORED_CONTENT_TOOL_SOURCE_SHA256__: JSON.stringify(toolingSourceSha256) }
};
await Promise.all([
    build({ ...shared, entryPoints: [path.join(extensionRoot, "tooling/index.ts")], format: "esm", outfile: path.join(dist, "index.mjs") }),
    build({ ...shared, entryPoints: [path.join(extensionRoot, "tooling/index.ts")], format: "cjs", outfile: path.join(dist, "index.cjs") }),
    build({
        ...shared,
        entryPoints: [path.join(extensionRoot, "tooling/cli.ts")],
        format: "cjs",
        outfile: path.join(dist, "cli.cjs"),
        banner: { js: "#!/usr/bin/env node" }
    }),
    build({
        ...shared,
        entryPoints: [path.join(extensionRoot, "tooling/publish/AtomicAuthoredContentPublisher.ts")],
        format: "esm",
        outfile: path.join(repositoryRoot, "build/authored-content-tooling-tests/AtomicAuthoredContentPublisher.mjs")
    }),
    build({
        ...shared,
        entryPoints: [path.join(extensionRoot, "tooling/project/ProviderPreflight.ts")],
        format: "esm",
        outfile: path.join(repositoryRoot, "build/authored-content-tooling-tests/ProviderPreflight.mjs")
    }),
    build({
        ...shared,
        entryPoints: [path.join(extensionRoot, "tooling/project/AuthoredContentProject.ts")],
        format: "esm",
        outfile: path.join(repositoryRoot, "build/authored-content-tooling-tests/AuthoredContentProject.mjs")
    })
]);

const nodeTypeRoots = path.dirname(path.dirname(require.resolve("@types/node/package.json")));
await run(process.execPath, [
    require.resolve("typescript/bin/tsc"),
    "-p", path.join(extensionRoot, "tsconfig.tooling.json"),
    "--typeRoots", nodeTypeRoots,
    "--pretty", "false"
]);
await mkdir(path.join(packageRoot, "schema"), { recursive: true });
await cp(path.join(repositoryRoot, "tooling/layaAuthoredContent/project-v1.json"), path.join(packageRoot, "schema/laya-authored-content-project-v1.schema.json"));
await cp(path.join(repositoryRoot, "tooling/layaAuthoredContent/locale-diff-request-v1.json"), path.join(packageRoot, "schema/laya-authored-content-locale-diff-request-v1.schema.json"));
await cp(path.join(repositoryRoot, "LICENSE"), path.join(packageRoot, "LICENSE"));

const manifest = {
    name: "@layabox/laya-authored-content",
    version: "0.1.0",
    description: "Headless, fail-closed LayaAir authored-content conversion entrypoint",
    license: "SEE LICENSE IN LICENSE",
    type: "module",
    sideEffects: false,
    engines: { node: ">=20" },
    bin: { "laya-authored-content": "./dist/cli.cjs" },
    exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs", require: "./dist/index.cjs" },
        "./schema/project-v1": "./schema/laya-authored-content-project-v1.schema.json",
        "./schema/locale-diff-request-v1": "./schema/laya-authored-content-locale-diff-request-v1.schema.json",
        "./package.json": "./package.json"
    },
    files: ["dist", "schema", "README.md", "LICENSE"]
};
manifest.layaAuthoredContentProvider = { commit: providerCommit, toolingSourceSha256 };
await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(packageRoot, "README.md"), `# @layabox/laya-authored-content

This is the headless LayaAir-owned authored-content conversion API and CLI.
The conversion entrypoint authenticates project, provider, capability, and
input identities, then returns a deterministic HOLD receipt until a Node-safe
adapter is admitted. The derive-locale command compares normalized neutral IR
files and atomically writes or checks a deterministic locale overlay. It never
loads IDE globals or claims raw SWF support.
`, "utf8");

async function run(command, arguments_) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, arguments_, { cwd: repositoryRoot, stdio: "inherit", windowsHide: true });
        child.on("error", reject);
        child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
    });
}

async function capture(command, arguments_) {
    return await new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        const child = spawn(command, arguments_, { cwd: repositoryRoot, windowsHide: true });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.on("exit", code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
    });
}
