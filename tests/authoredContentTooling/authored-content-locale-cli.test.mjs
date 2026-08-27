import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repositoryRoot, "build/npm-packages/laya-authored-content/dist/cli.cjs");

function document(initialText) {
    return {
        schema: "neutral-authored-content@1",
        documentId: "Lobby.Root",
        resources: [],
        root: {
            linkage: "Lobby.Root", instanceId: "Lobby.Root", kind: "container", children: [{
                linkage: "label", instanceId: "label", name: "label", kind: "dynamic-text", children: [],
                textField: {
                    sourceId: 1, type: "dynamic", multiline: false, wordWrap: false, selectable: false,
                    displayAsPassword: false, autoSize: "none", html: false, filters: [], gutter: 2,
                    overflow: "hidden", initialText,
                    format: { fontMode: "device", font: "Arial", size: 12, color: 0, bold: false, italic: false, underline: false, align: "left", leftMargin: 0, rightMargin: 0, indent: 0, leading: 0, letterSpacing: 0, kerning: false }
                }
            }]
        },
        timeline: { frameRate: 24, duration: 1, loop: false, frameLabels: {}, tracks: [] }
    };
}

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "laya-locale-cli-"));
    await mkdir(path.join(root, "ir"));
    await writeFile(path.join(root, "ir/base.json"), JSON.stringify(document("Ready")));
    await writeFile(path.join(root, "ir/fr.json"), JSON.stringify(document("Pret")));
    const request = {
        schema: "laya-authored-content-locale-diff-request@1",
        id: "lobby-fr",
        locale: "fr_FR",
        baseCatalog: "Lobby.runtime-catalog.json",
        bundles: [{ bundle: "lobby", base: "ir/base.json", localized: "ir/fr.json" }]
    };
    const requestPath = path.join(root, "request.json");
    const outputPath = path.join(root, "output/Lobby.fr_FR.locale.json");
    await writeFile(requestPath, JSON.stringify(request));
    return { root, request, requestPath, outputPath };
}

function invoke(...arguments_) {
    return spawnSync(process.execPath, [cli, ...arguments_], { encoding: "utf8", windowsHide: true });
}

test("derive-locale writes canonical output atomically and check rebuilds without mutation", async () => {
    const value = await fixture();
    try {
        const missing = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath, "--check");
        assert.equal(missing.status, 1);
        assert.equal(JSON.parse(missing.stderr).code, "AUTHORED_CONTENT_LOCALE_OUTPUT_DRIFT");

        const written = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath);
        assert.equal(written.status, 0, written.stderr);
        const result = JSON.parse(written.stdout);
        assert.equal(result.status, "written");
        assert.deepEqual(result.overlay.translations, [{ bundle: "lobby", target: "label", text: "Pret" }]);
        const canonical = await readFile(value.outputPath, "utf8");
        assert.equal(canonical, `${JSON.stringify({
            assetOverrides: [], baseCatalog: "Lobby.runtime-catalog.json", id: "lobby-fr", locale: "fr_FR",
            schema: "laya-authored-content-locale@1", translations: [{ bundle: "lobby", target: "label", text: "Pret" }]
        })}\n`);
        assert.deepEqual((await readdir(path.dirname(value.outputPath))).sort(), [path.basename(value.outputPath)]);

        const checked = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath, "--check");
        assert.equal(checked.status, 0, checked.stderr);
        assert.equal(JSON.parse(checked.stdout).status, "unchanged");
        assert.equal(await readFile(value.outputPath, "utf8"), canonical);

        await writeFile(value.outputPath, JSON.stringify(JSON.parse(canonical), null, 2));
        const drift = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath, "--check");
        assert.equal(drift.status, 1);
        assert.equal(JSON.parse(drift.stderr).code, "AUTHORED_CONTENT_LOCALE_OUTPUT_DRIFT");
        assert.notEqual(await readFile(value.outputPath, "utf8"), canonical, "check unexpectedly rewrote drift");

        const repaired = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath);
        assert.equal(repaired.status, 0, repaired.stderr);
        assert.equal(await readFile(value.outputPath, "utf8"), canonical);
    }
    finally { await rm(value.root, { recursive: true, force: true }); }
});

test("derive-locale rejects extra request fields and input path escapes", async () => {
    const value = await fixture();
    try {
        await writeFile(value.requestPath, JSON.stringify({ ...value.request, invented: true }));
        const extra = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath);
        assert.equal(extra.status, 1);
        assert.equal(JSON.parse(extra.stderr).code, "AUTHORED_CONTENT_LOCALE_DIFF_KEYS");

        await writeFile(path.join(value.root, "outside.json"), JSON.stringify(document("Outside")));
        await writeFile(value.requestPath, JSON.stringify({
            ...value.request,
            bundles: [{ ...value.request.bundles[0], localized: "../outside.json" }]
        }));
        const escape = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath);
        assert.equal(escape.status, 1);
        assert.equal(JSON.parse(escape.stderr).code, "AUTHORED_CONTENT_LOCALE_INPUT_PATH");
        assert.rejects(readFile(value.outputPath));
    }
    finally { await rm(value.root, { recursive: true, force: true }); }
});

test("derive-locale rejects unrelated CLI options", async () => {
    const value = await fixture();
    try {
        const result = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath, "--project", value.requestPath);
        assert.equal(result.status, 1);
        assert.equal(JSON.parse(result.stderr).code, "AUTHORED_CONTENT_CLI_OPTION");
    }
    finally { await rm(value.root, { recursive: true, force: true }); }
});

test("derive-locale passes the strict text-map-only request policy to the API", async () => {
    const value = await fixture();
    try {
        const base = document("Ready");
        const localized = document("Pret");
        base.root.children[0].name = "character_82";
        localized.root.children[0].name = "character_81";
        localized.timeline.duration = 7;
        await writeFile(path.join(value.root, "ir/base.json"), JSON.stringify(base));
        await writeFile(path.join(value.root, "ir/fr.json"), JSON.stringify(localized));
        await writeFile(value.requestPath, JSON.stringify({ ...value.request, mode: "text-map-only" }));
        const result = invoke("derive-locale", "--request", value.requestPath, "--output", value.outputPath);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout).overlay.translations, [{ bundle: "lobby", target: "character_82", text: "Pret" }]);
    }
    finally { await rm(value.root, { recursive: true, force: true }); }
});
