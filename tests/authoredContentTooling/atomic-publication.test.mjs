import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publisher = await import(pathToFileURL(path.join(repositoryRoot, "build/authored-content-tooling-tests/AtomicAuthoredContentPublisher.mjs")));

test("publication is atomic, exact, content addressed, and a verified no-op", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "laya-authored-publish-"));
    const receipt = makeReceipt([{ path: "prefabs/Root.lh", bytes: Buffer.from("prefab") }]);
    let writes = 0;
    const write = async stage => { writes++; await mkdir(path.join(stage, "prefabs")); await writeFile(path.join(stage, "prefabs/Root.lh"), "prefab", { flag: "wx" }); };
    const first = await publisher.publishAuthoredContentGeneration({ destinationRoot: root, receipt, writeStaging: write });
    assert.equal(first.status, "published");
    const pointerPath = path.join(root, ".laya-authored-content/current.json");
    const pointerBytes = await readFile(pointerPath);
    const pointerTime = (await stat(pointerPath)).mtimeMs;
    const second = await publisher.publishAuthoredContentGeneration({ destinationRoot: root, receipt, writeStaging: async () => { throw new Error("no-op writer called"); } });
    assert.equal(second.status, "unchanged");
    assert.equal(writes, 1);
    assert.deepEqual(await readFile(pointerPath), pointerBytes);
    assert.equal((await stat(pointerPath)).mtimeMs, pointerTime);

    await t.test("failure before pointer commit preserves the old pointer", async () => {
        const next = makeReceipt([{ path: "prefabs/Root.lh", bytes: Buffer.from("next") }]);
        await assert.rejects(publisher.publishAuthoredContentGeneration({
            destinationRoot: root,
            receipt: next,
            writeStaging: async stage => { await mkdir(path.join(stage, "prefabs")); await writeFile(path.join(stage, "prefabs/Root.lh"), "next", { flag: "wx" }); },
            failpoint: name => { if (name === "after-generation-rename") throw new Error("injected"); }
        }), /injected/);
        assert.deepEqual(await readFile(pointerPath), pointerBytes);
    });

    await t.test("a post-commit exception reconciles as success", async () => {
        const next = makeReceipt([{ path: "prefabs/Root.lh", bytes: Buffer.from("committed") }]);
        const result = await publisher.publishAuthoredContentGeneration({
            destinationRoot: root,
            receipt: next,
            writeStaging: async stage => { await mkdir(path.join(stage, "prefabs")); await writeFile(path.join(stage, "prefabs/Root.lh"), "committed", { flag: "wx" }); },
            failpoint: name => { if (name === "after-pointer-rename") throw new Error("injected after commit"); }
        });
        assert.equal(result.status, "published");
        assert.equal(JSON.parse(await readFile(pointerPath, "utf8")).generation, next.receiptSubjectSha256);
    });
});

test("publication refuses rogue output and a busy destination without changing current", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "laya-authored-refuse-"));
    const receipt = makeReceipt([{ path: "Root.lh", bytes: Buffer.from("expected") }]);
    await assert.rejects(publisher.publishAuthoredContentGeneration({
        destinationRoot: root,
        receipt,
        writeStaging: async stage => { await writeFile(path.join(stage, "Root.lh"), "expected"); await writeFile(path.join(stage, "rogue.txt"), "rogue"); }
    }), error => error.code === "AUTHORED_CONTENT_INVENTORY_MISMATCH");
    await mkdir(path.join(root, ".laya-authored-content/lock"));
    await assert.rejects(publisher.publishAuthoredContentGeneration({ destinationRoot: root, receipt, writeStaging: async () => {} }), error => error.code === "AUTHORED_CONTENT_PUBLICATION_BUSY");
});

function makeReceipt(files) {
    const inventory = files.map(file => ({ path: file.path, sha256: digest(file.bytes), size: file.bytes.length })).sort((a, b) => a.path.localeCompare(b.path));
    const subject = {
        schema: "laya-authored-content-receipt@1",
        toolVersion: "0.1.0",
        command: "publish",
        status: "published",
        projectSha256: digest("project"),
        requestSha256: digest("request"),
        provider: {
            repository: "LayaAir", commit: "1".repeat(40), packageVersion: "3.4.0", published: true,
            remote: { name: "origin", url: "https://example.invalid/LayaAir.git", ref: "refs/remotes/origin/main", commit: "1".repeat(40) },
            capabilityLedger: { path: "ledger.json", schema: "laya-authored-content-capabilities@1", hashMode: "canonical-lf-utf8", sha256: digest("ledger") }
        },
        inputs: [], inventory, inventorySha256: digest(`${canonical(inventory)}\n`), holds: []
    };
    return { ...subject, receiptSubjectSha256: digest(`${canonical(subject)}\n`) };
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
}
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
