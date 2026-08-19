import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const updater = path.join(root, "scripts/updateAuthoredContentHashes.mjs");
const generated = [
    "docTool/architecture/authored-content-capabilities.json",
    "docTool/architecture/flash-runtime-type-predicates.json",
    "docTool/architecture/flash-runtime-type-predicates.sha256",
].map(relative => path.join(root, relative));

test("hash updater converges once and --check performs no writes", () => {
    runUpdater();
    const first = snapshot();
    runUpdater();
    const second = snapshot();
    assert.deepEqual(second.map(item => item.bytes), first.map(item => item.bytes),
        "a second update changed generated authority");

    runUpdater("--check");
    const checked = snapshot();
    assert.deepEqual(checked, second, "--check wrote generated authority");

    const rejected = spawnSync(process.execPath, [updater, "--unknown"], {
        cwd: root,
        encoding: "utf8"
    });
    assert.notEqual(rejected.status, 0, "unknown updater argument was accepted");
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /Unsupported argument: --unknown/);
    assert.deepEqual(snapshot(), checked, "rejected updater argument wrote generated authority");
});

function runUpdater(...args) {
    const result = spawnSync(process.execPath, [updater, ...args], {
        cwd: root,
        encoding: "utf8"
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function snapshot() {
    return generated.map(file => {
        const stat = fs.statSync(file, { bigint: true });
        return {
            bytes: fs.readFileSync(file),
            mtimeNs: stat.mtimeNs,
            ctimeNs: stat.ctimeNs,
        };
    });
}
