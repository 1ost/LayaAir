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

const pythonExecutable = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
execFileSync(pythonExecutable, [path.join(repositoryRoot, "tests", "authoredContentTooling", "swf-to-laya-provider.test.py")], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
});
