import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(pluginRoot, "../../..");

execFileSync(process.execPath, [path.join(scriptDirectory, "testCore.cjs")], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: process.env
});
execFileSync(process.execPath, [path.join(repositoryRoot, "tests", "authoredContentCockpit", "run.mjs")], {
    cwd: repositoryRoot,
    stdio: "inherit"
});
