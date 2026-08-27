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
const projectValidator = await import(pathToFileURL(path.join(repositoryRoot, "build/authored-content-tooling-tests/AuthoredContentProject.mjs")));

test("public package imports without IDE globals and exposes only the headless API", () => {
    assert.equal(globalThis.Laya, undefined);
    assert.deepEqual(Object.keys(api).sort(), [
        "AUTHORED_CONTENT_LOCALE_SCHEMA",
        "AUTHORED_CONTENT_PROJECT_SCHEMA",
        "AUTHORED_CONTENT_RECEIPT_SCHEMA",
        "AUTHORED_CONTENT_TOOL_SOURCE_SHA256",
        "AUTHORED_CONTENT_TOOL_VERSION",
        "AuthoredContentToolError",
        "checkAuthoredContentDelivery",
        "convertAuthoredContent",
        "deriveAuthoredContentLocaleOverlay"
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

test("project schema scalar constraints are differential-locked to the runtime validator", async t => {
    const schema = JSON.parse(await readFile(path.join(repositoryRoot, "tooling/layaAuthoredContent/project-v1.json"), "utf8"));
    const base = schemaProbeProject();
    const scalar = (definition, value) => {
        if (definition.type === "string" && typeof value !== "string") return false;
        if (definition.type === "integer" && !Number.isInteger(value)) return false;
        if (definition.minimum !== undefined && value < definition.minimum) return false;
        if (definition.maximum !== undefined && value > definition.maximum) return false;
        if (definition.pattern !== undefined && !new RegExp(definition.pattern, "u").test(value)) return false;
        if (definition.enum !== undefined && !definition.enum.includes(value)) return false;
        return true;
    };
    const runtime = (mutate, value) => {
        const document = structuredClone(base);
        mutate(document, value);
        try { projectValidator.validateAuthoredContentProjectDocument(document); return true; }
        catch { return false; }
    };
    const compare = async (label, definition, mutate, accepted, rejected) => t.test(label, () => {
        for (const value of [...accepted, ...rejected])
            assert.equal(runtime(mutate, value), scalar(definition, value), `${label}: ${JSON.stringify(value)}`);
        for (const value of accepted) assert.equal(scalar(definition, value), true, `${label} accepted vector`);
        for (const value of rejected) assert.equal(scalar(definition, value), false, `${label} rejected vector`);
    });

    const stable = schema.$defs.stableString;
    await compare("packageVersion", stable, (p, v) => { p.provider.packageVersion = v; },
        ["3.4.0", "release candidate", "a\nb", "caf\u00e9"],
        ["", " x", "x ", "\tx", "x\n", "\ufeffx", "x\u00a0", "x\0y"]);
    await compare("remote.url", stable, (p, v) => { p.provider.remote.url = v; },
        ["https://example.invalid/LayaAir.git", "ssh://host/path with space", "a\nb"],
        ["", " url", "url ", "\nurl", "url\r", "x\0y"]);

    const relativePath = schema.$defs.relativePath;
    const devices = ["con", "prn", "aux", "nul", ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)];
    const reserved = devices.flatMap(name => [name, name.toUpperCase(), `${name[0].toUpperCase()}${name.slice(1)}.txt`, `safe/${name.toUpperCase()}.bin`]);
    const validPaths = ["Root.lh", "safe/conductor.lh", "safe/com0.bin", "safe/com10.bin", "safe/auxiliary", "caf\u00e9/file"];
    const invalidPaths = [
        ...reserved, "", "/root", "C:/root", "a\\b", "a:b", "a//b", "a/./b", "a/../b", "a.", "a ", "a/", "a\u0001b",
        " assets/root", "assets/root ", "\tassets/root", "assets/root\n", "\ufeffassets/root", "assets/root\u00a0"
    ];
    await compare("job.output relativePath", relativePath, (p, v) => { p.jobs[0].output = v; }, validPaths, invalidPaths);
    await compare("input.path relativePath", relativePath, (p, v) => { p.jobs[0].input.path = v; }, validPaths, invalidPaths);
    await compare("capabilityLedger.path relativePath", relativePath, (p, v) => { p.provider.capabilityLedger.path = v; }, validPaths, invalidPaths);

    const remoteRef = schema.$defs.remoteRef;
    await compare("remote.ref", remoteRef, (p, v) => { p.provider.remote.ref = v; },
        ["refs/remotes/origin/main", "refs/remotes/origin/feature /x", "refs/remotes/origin/x:y"],
        ["", " refs/remotes/origin/main", "refs/remotes/origin/main ", "refs/heads/main", "refs/remotes/origin/../main", "refs/remotes/origin/x\0y"]);
    await compare("id", schema.$defs.id, (p, v) => { p.jobs[0].id = v; },
        ["job", "job-1", "a.b/c:d_1"], ["", " job", "job ", "-job", "j ob", "j\u00e9"]);
    await compare("gitOid", schema.$defs.gitOid, (p, v) => { p.provider.commit = v; },
        ["a".repeat(40)], ["A".repeat(40), "a".repeat(39), "g".repeat(40), 1]);
    await compare("sha256", schema.$defs.sha256, (p, v) => { p.jobs[0].input.sha256 = v; },
        ["b".repeat(64)], ["B".repeat(64), "b".repeat(63), "z".repeat(64), null]);

    const size = schema.properties.jobs.items.properties.input.properties.size;
    await compare("input.size", size, (p, v) => { p.jobs[0].input.size = v; },
        [0, 1, Number.MAX_SAFE_INTEGER], [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]);
    const kind = schema.properties.jobs.items.properties.input.properties.kind;
    await compare("input.kind", kind, (p, v) => { p.jobs[0].input.kind = v; },
        kind.enum, ["swf", "", null]);

    await t.test("document-only cross-field constraints remain explicit and fail closed", () => {
        assert.throws(() => projectValidator.validateAuthoredContentProjectDocument({
            ...structuredClone(base),
            provider: { ...structuredClone(base.provider), remote: { ...structuredClone(base.provider.remote), ref: "refs/remotes/upstream/main" } }
        }), /REMOTE_REF/);
        const duplicate = structuredClone(base);
        duplicate.jobs.push(structuredClone(duplicate.jobs[0]));
        assert.throws(() => projectValidator.validateAuthoredContentProjectDocument(duplicate), /unique/);
        const overlap = structuredClone(base);
        overlap.jobs.push({ ...structuredClone(overlap.jobs[0]), id: "second", output: "assets/root/child" });
        assert.throws(() => projectValidator.validateAuthoredContentProjectDocument(overlap), /overlaps/);
    });
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

function schemaProbeProject() {
    return {
        schema: "laya-authored-content-project@1",
        provider: {
            repository: "LayaAir",
            commit: "a".repeat(40),
            packageVersion: "3.4.0",
            remote: { name: "origin", url: "https://example.invalid/LayaAir.git", ref: "refs/remotes/origin/main", commit: "a".repeat(40) },
            capabilityLedger: {
                path: "docTool/architecture/authored-content-capabilities.json",
                schema: "laya-authored-content-capabilities@1",
                hashMode: "canonical-lf-utf8",
                sha256: "b".repeat(64)
            }
        },
        jobs: [{
            id: "probe",
            input: { kind: "neutral-ir", path: "input.json", sha256: "c".repeat(64), size: 0 },
            entries: ["Root"], locales: [], output: "assets/root", requiredCapabilities: []
        }]
    };
}

function git(...args) {
    return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
async function exists(value) { try { await readFile(value); return true; } catch { return false; } }
