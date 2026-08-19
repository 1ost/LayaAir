import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publisher = await import(pathToFileURL(path.join(repositoryRoot, "build/authored-content-tooling-tests/AtomicAuthoredContentPublisher.mjs")));
const api = await import(pathToFileURL(path.join(repositoryRoot, "build/npm-packages/laya-authored-content/dist/index.mjs")));

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

test("every commit boundary failpoint is fail-closed or reconciled after commit", async t => {
    const precommit = ["after-lock", "after-stage-write", "after-stage-validation", "after-final-validation", "after-generation-rename", "before-pointer-rename"];
    for (const point of precommit) await t.test(point, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), `laya-fail-${point}-`));
        const receipt = makeReceipt([{ path: "Root.lh", bytes: Buffer.from("stable") }]);
        let stagePath;
        await assert.rejects(publisher.publishAuthoredContentGeneration({
            destinationRoot: root,
            receipt,
            writeStaging: async stage => { stagePath = stage; await writeFile(path.join(stage, "Root.lh"), "stable", { flag: "wx" }); },
            failpoint: async name => {
                if (name !== point) return;
                if (point === "after-stage-validation") {
                    await writeFile(path.join(stagePath, "Root.lh"), "tampered-after-validation");
                    return;
                }
                throw new Error(`injected ${point}`);
            }
        }));
        await assert.rejects(readFile(path.join(root, ".laya-authored-content/current.json")));
    });
    for (const point of ["after-pointer-rename", "cleanup", "before-lock-release"]) await t.test(point, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), `laya-commit-${point}-`));
        const receipt = makeReceipt([{ path: "Root.lh", bytes: Buffer.from("stable") }]);
        const result = await publisher.publishAuthoredContentGeneration({
            destinationRoot: root,
            receipt,
            writeStaging: stage => writeFile(path.join(stage, "Root.lh"), "stable", { flag: "wx" }),
            failpoint: name => { if (name === point) throw new Error(`injected ${point}`); }
        });
        assert.equal(result.status, "published");
        assert.equal(JSON.parse(await readFile(path.join(root, ".laya-authored-content/current.json"), "utf8")).generation, receipt.receiptSubjectSha256);
    });
});

test("rollback authenticates complete receipts and refuses forged generations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "laya-authored-rollback-"));
    const first = makeReceipt([{ path: "Root.lh", bytes: Buffer.from("first") }]);
    const second = makeReceipt([{ path: "Root.lh", bytes: Buffer.from("second") }]);
    const write = value => async stage => writeFile(path.join(stage, "Root.lh"), value, { flag: "wx" });
    await publisher.publishAuthoredContentGeneration({ destinationRoot: root, receipt: first, writeStaging: write("first") });
    await publisher.publishAuthoredContentGeneration({ destinationRoot: root, receipt: second, writeStaging: write("second") });
    await publisher.rollbackAuthoredContentGeneration(root, first.receiptSubjectSha256);
    assert.equal(JSON.parse(await readFile(path.join(root, ".laya-authored-content/current.json"), "utf8")).generation, first.receiptSubjectSha256);
    const receiptPath = path.join(root, ".laya-authored-content/generations", first.receiptSubjectSha256, "laya-authored-content-receipt.json");
    const forged = JSON.parse(await readFile(receiptPath, "utf8"));
    forged.inventory[0].size++;
    await chmod(receiptPath, 0o666);
    await writeFile(receiptPath, `${JSON.stringify(forged)}\n`);
    await assert.rejects(publisher.rollbackAuthoredContentGeneration(root, first.receiptSubjectSha256));
});

test("delivery verification rejects mutation, extra files, and symlink aliases", async t => {
    const receipt = makeReceipt([{ path: "Root.lh", bytes: Buffer.from("stable") }]);
    for (const mode of ["mutated", "extra", "symlink"]) await t.test(mode, async t2 => {
        const root = await mkdtemp(path.join(os.tmpdir(), `laya-authored-delivery-${mode}-`));
        await publisher.publishAuthoredContentGeneration({ destinationRoot: root, receipt, writeStaging: stage => writeFile(path.join(stage, "Root.lh"), "stable", { flag: "wx" }) });
        const generation = path.join(root, ".laya-authored-content/generations", receipt.receiptSubjectSha256);
        if (mode === "mutated") { await chmod(path.join(generation, "Root.lh"), 0o666); await writeFile(path.join(generation, "Root.lh"), "mutated"); }
        if (mode === "extra") { await chmod(generation, 0o755); await writeFile(path.join(generation, "extra.bin"), "extra"); }
        if (mode === "symlink") {
            await chmod(generation, 0o755);
            try { await symlink(path.join(generation, "Root.lh"), path.join(generation, "alias.lh")); }
            catch (error) { if (error.code === "EPERM") return t2.skip("symlink creation is not permitted"); throw error; }
        }
        await assert.rejects(publisher.checkPublishedAuthoredContentGeneration(root));
    });
});

test("public check-delivery authenticates the stored receipt, provider, ledger, and complete inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "laya-authored-check-delivery-"));
    const receipt = makeReceipt([{ path: "Root.lh", bytes: Buffer.from("stable") }], await actualProvider());
    await publisher.publishAuthoredContentGeneration({ destinationRoot: root, receipt, writeStaging: stage => writeFile(path.join(stage, "Root.lh"), "stable", { flag: "wx" }) });
    const checked = await api.checkAuthoredContentDelivery({ deliveryRoot: root, providerRoot: repositoryRoot });
    assert.equal(checked.exitCode, 0);
    assert.deepEqual(checked.receipt, receipt);
    const generationFile = path.join(root, ".laya-authored-content/generations", receipt.receiptSubjectSha256, "Root.lh");
    await chmod(generationFile, 0o666);
    await writeFile(generationFile, "mutated");
    await assert.rejects(api.checkAuthoredContentDelivery({ deliveryRoot: root, providerRoot: repositoryRoot }));
});

function makeReceipt(files, provider = undefined) {
    const inventory = files.map(file => ({ path: file.path, sha256: digest(file.bytes), size: file.bytes.length })).sort((a, b) => a.path.localeCompare(b.path));
    const subject = {
        schema: "laya-authored-content-receipt@1",
        toolVersion: "0.1.0",
        command: "publish",
        status: "published",
        projectSha256: digest("project"),
        requestSha256: digest("request"),
        provider: provider ?? {
            repository: "LayaAir", commit: "1".repeat(40), packageVersion: "3.4.0", published: true,
            remote: { name: "origin", url: "https://example.invalid/LayaAir.git", ref: "refs/remotes/origin/main", commit: "1".repeat(40) },
            capabilityLedger: { path: "ledger.json", schema: "laya-authored-content-capabilities@1", hashMode: "canonical-lf-utf8", sha256: digest("ledger") },
            tooling: { package: "@layabox/laya-authored-content", version: "0.1.0", commit: "1".repeat(40), sourceSha256: digest("tooling") }
        },
        inputs: [], inventory, inventorySha256: digest(`${canonical(inventory)}\n`), holds: []
    };
    return { ...subject, receiptSubjectSha256: digest(`${canonical(subject)}\n`) };
}

async function actualProvider() {
    const remoteName = "origin";
    const remoteRef = git("for-each-ref", "--format=%(refname)", `refs/remotes/${remoteName}`).split(/\r?\n/).find(ref => ref && !ref.endsWith("/HEAD"));
    assert.ok(remoteRef);
    const commit = git("rev-parse", "HEAD");
    const ledgerPath = "docTool/architecture/authored-content-capabilities.json";
    const ledger = await readFile(path.join(repositoryRoot, ledgerPath));
    return {
        repository: "LayaAir",
        commit,
        packageVersion: "3.4.0",
        remote: { name: remoteName, url: git("remote", "get-url", remoteName), ref: remoteRef, commit: git("rev-parse", remoteRef) },
        published: commit === git("rev-parse", remoteRef),
        capabilityLedger: { path: ledgerPath, schema: "laya-authored-content-capabilities@1", hashMode: "canonical-lf-utf8", sha256: digest(Buffer.from(ledger.toString("utf8").replace(/\r\n?/g, "\n"))) },
        tooling: { package: "@layabox/laya-authored-content", version: "0.1.0", commit, sourceSha256: api.AUTHORED_CONTENT_TOOL_SOURCE_SHA256 }
    };
}

function git(...args) { return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", windowsHide: true }).trim(); }

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
}
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
