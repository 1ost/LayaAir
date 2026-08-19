import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = path.join(repositoryRoot, "build/npm-packages/laya-authored-content");
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const api = await import(pathToFileURL(path.join(packageRoot, "dist/index.mjs")));

test("public package imports without IDE globals and exposes only the headless API", () => {
    assert.equal(globalThis.Laya, undefined);
    assert.deepEqual(Object.keys(api).sort(), [
        "AUTHORED_CONTENT_PROJECT_SCHEMA",
        "AUTHORED_CONTENT_RECEIPT_SCHEMA",
        "AUTHORED_CONTENT_TOOL_SOURCE_SHA256",
        "AUTHORED_CONTENT_TOOL_VERSION",
        "AuthoredContentToolError",
        "checkAuthoredContentDelivery",
        "convertAuthoredContent"
    ]);
});

test("authenticated unsupported jobs return a deterministic fail-closed HOLD receipt", async () => {
    const fixture = await projectFixture();
    try {
        const request = { command: "check", projectPath: fixture.projectPath, workspaceRoot: fixture.workspace, providerRoot: repositoryRoot };
        const first = await api.convertAuthoredContent(request);
        const second = await api.convertAuthoredContent(request);
        assert.deepEqual(second, first);
        assert.equal(first.exitCode, 2);
        assert.equal(first.receipt.status, "hold");
        assert.deepEqual(first.receipt.inventory, []);
        assert.ok(first.receipt.holds.some(hold => hold.code === "AUTHORED_CONTENT_INPUT_ADAPTER_HOLD"));
        assert.ok(first.receipt.holds.some(hold => hold.code === "AUTHORED_CONTENT_CAPABILITY_BLOCKING"));
        assert.ok(first.receipt.holds.some(hold => hold.code === "AUTHORED_CONTENT_PROVIDER_UNPUBLISHED"));
        assert.equal(await exists(path.join(fixture.workspace, "output")), false);

        const cli = spawnSync(process.execPath, [
            path.join(packageRoot, "dist/cli.cjs"), "check",
            "--project", fixture.projectPath,
            "--workspace-root", fixture.workspace,
            "--provider-root", repositoryRoot
        ], { cwd: os.tmpdir(), encoding: "utf8", windowsHide: true });
        assert.equal(cli.status, 2, cli.stderr);
        assert.deepEqual(JSON.parse(cli.stdout), first.receipt);
        assert.equal(cli.stderr, "");
    }
    finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test("strict projects reject duplicate keys, drift, and conversion without an output root", async () => {
    const fixture = await projectFixture();
    try {
        const original = await readFile(fixture.projectPath, "utf8");
        await writeFile(fixture.projectPath, original.replace('"schema":', '"schema":"laya-authored-content-project@1","schema2":').replace('"schema2":"laya-authored-content-project@1"', '"schema2":"laya-authored-content-project@1"'));
        await assert.rejects(
            api.convertAuthoredContent({ command: "check", projectPath: fixture.projectPath, workspaceRoot: fixture.workspace, providerRoot: repositoryRoot }),
            error => error.code === "AUTHORED_CONTENT_KEYS"
        );
        await writeFile(fixture.projectPath, original);
        await writeFile(path.join(fixture.workspace, "input.swf"), "mutated");
        await assert.rejects(
            api.convertAuthoredContent({ command: "check", projectPath: fixture.projectPath, workspaceRoot: fixture.workspace, providerRoot: repositoryRoot }),
            error => error.code === "AUTHORED_CONTENT_INPUT_SIZE_MISMATCH" || error.code === "AUTHORED_CONTENT_INPUT_HASH_MISMATCH"
        );
        await assert.rejects(
            api.convertAuthoredContent({ command: "convert", projectPath: fixture.projectPath, workspaceRoot: fixture.workspace, providerRoot: repositoryRoot }),
            error => error.code === "AUTHORED_CONTENT_OUTPUT_REQUIRED"
        );
    }
    finally { await rm(fixture.workspace, { recursive: true, force: true }); }
});

test("validation errors exit 1 while only an authenticated HOLD exits 2", async () => {
    const cli = spawnSync(process.execPath, [path.join(packageRoot, "dist/cli.cjs"), "unknown"], { encoding: "utf8", windowsHide: true });
    assert.equal(cli.status, 1);
    assert.equal(cli.stdout, "");
    assert.equal(JSON.parse(cli.stderr).schema, "laya-authored-content-cli-error@1");
});

test("input authentication rejects symbolic links", async t => {
    const fixture = await projectFixture();
    const external = path.join(path.dirname(fixture.workspace), `${path.basename(fixture.workspace)}-outside.swf`);
    try {
        await writeFile(external, "outside");
        await rm(path.join(fixture.workspace, "input.swf"));
        try { await symlink(external, path.join(fixture.workspace, "input.swf")); }
        catch (error) { if (error.code === "EPERM") return t.skip("symlink creation is not permitted"); throw error; }
        await assert.rejects(
            api.convertAuthoredContent({ command: "check", projectPath: fixture.projectPath, workspaceRoot: fixture.workspace, providerRoot: repositoryRoot }),
            error => error.code === "AUTHORED_CONTENT_INPUT_SYMLINK"
        );
    }
    finally { await rm(external, { force: true }); await rm(fixture.workspace, { recursive: true, force: true }); }
});

test("generated package packs without IDE implementation sources and supports ESM, CJS, and its bin", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "laya-authored-package-"));
    try {
        const packed = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "--json", "--pack-destination", temporary], {
            cwd: packageRoot, encoding: "utf8", windowsHide: true
        }))[0];
        const names = packed.files.map(file => file.path);
        assert.ok(names.includes("dist/index.mjs"));
        assert.ok(names.includes("dist/index.cjs"));
        assert.ok(names.includes("dist/cli.cjs"));
        assert.equal(names.some(name => /(?:EnvMain|UIMain|editorResources|\.ts$)/.test(name) && !name.endsWith(".d.ts")), false);
        const installRoot = path.join(temporary, "consumer");
        await mkdir(installRoot);
        await writeFile(path.join(installRoot, "package.json"), '{"type":"module"}\n');
        execFileSync(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(temporary, packed.filename)], {
            cwd: installRoot, encoding: "utf8", windowsHide: true
        });
        const esm = spawnSync(process.execPath, ["--input-type=module", "-e", "import('@layabox/laya-authored-content').then(m=>console.log(m.AUTHORED_CONTENT_TOOL_VERSION))"], { cwd: installRoot, encoding: "utf8", windowsHide: true });
        assert.equal(esm.status, 0, esm.stderr);
        assert.equal(esm.stdout.trim(), "0.1.0");
        const cjs = spawnSync(process.execPath, ["-e", "console.log(require('@layabox/laya-authored-content').AUTHORED_CONTENT_TOOL_VERSION)"], { cwd: installRoot, encoding: "utf8", windowsHide: true });
        assert.equal(cjs.status, 0, cjs.stderr);
        const bin = spawnSync(process.execPath, [path.join(installRoot, "node_modules/@layabox/laya-authored-content/dist/cli.cjs"), "--version"], { cwd: os.tmpdir(), encoding: "utf8", windowsHide: true });
        assert.equal(bin.status, 0, bin.stderr);
        assert.equal(bin.stdout.trim(), "0.1.0");
    }
    finally { await rm(temporary, { recursive: true, force: true }); }
});

async function projectFixture() {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "laya-authored-project-"));
    const input = Buffer.from("FWS\u0009deterministic-fixture", "utf8");
    await writeFile(path.join(workspace, "input.swf"), input);
    const head = git("rev-parse", "HEAD");
    const remoteName = "origin";
    const remoteRef = git("for-each-ref", "--format=%(refname)", `refs/remotes/${remoteName}`)
        .split(/\r?\n/).find(ref => ref && !ref.endsWith("/HEAD"));
    assert.ok(remoteRef, `provider checkout has no ${remoteName} remote-tracking ref`);
    const ledgerPath = "docTool/architecture/authored-content-capabilities.json";
    const ledger = await readFile(path.join(repositoryRoot, ledgerPath));
    const ledgerHash = digest(Buffer.from(ledger.toString("utf8").replace(/\r\n?/g, "\n"), "utf8"));
    const project = {
        schema: "laya-authored-content-project@1",
        provider: {
            repository: "LayaAir",
            commit: head,
            packageVersion: "3.4.0",
            remote: {
                name: remoteName,
                url: git("remote", "get-url", remoteName),
                ref: remoteRef,
                commit: git("rev-parse", remoteRef)
            },
            capabilityLedger: {
                path: ledgerPath,
                schema: "laya-authored-content-capabilities@1",
                hashMode: "canonical-lf-utf8",
                sha256: ledgerHash
            }
        },
        jobs: [{
            id: "fixture",
            input: { kind: "raw-swf", path: "input.swf", sha256: digest(input), size: input.length },
            entries: ["Root"],
            locales: [],
            output: "assets/authored/fixture",
            requiredCapabilities: ["native.prefab"]
        }]
    };
    const projectPath = path.join(workspace, "project.json");
    await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    return { workspace, projectPath };
}

function git(...args) {
    return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
async function exists(value) { try { await readFile(value); return true; } catch { return false; } }
