import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    EXACT_PIXEL_POLICY,
    canonicalJson,
    compareRgbaCaptures,
    createRgbaCapture,
    parseRgbaCapture,
    serializePixelGoldenReceipt,
    serializeRgbaCapture,
} from "../../scripts/authoredPixelGolden.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repositoryRoot, "scripts/authoredPixelGolden.mjs");
const zeroHash = "0".repeat(64);

function environment(changes = {}) {
    return {
        browser: { name: "Chromium", version: "128.0.0", revision: "r123456" },
        backend: { api: "webgl2", adapter: "ANGLE D3D11", driver: "31.0.15.1234" },
        fonts: { rasterizer: "DirectWrite 10.0", manifestSha256: "1".repeat(64) },
        platform: { os: "Windows 11 23H2", architecture: "x64", devicePixelRatio: 1 },
        ...changes,
    };
}

function capture(pixels = [0, 0, 0, 0, 10, 20, 30, 255], changes = {}) {
    return createRgbaCapture({ width: 2, height: 1, rgba: Uint8Array.from(pixels), environment: environment(), ...changes });
}

test("canonical straight-RGBA captures have stable pixel, body, and artifact identities", () => {
    const first = capture();
    const second = capture();
    assert.deepEqual(first, second);
    assert.match(first.rgbaSha256, /^[a-f0-9]{64}$/);
    assert.match(first.captureSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(first.rgbaSha256, first.captureSha256);
    const serialized = serializeRgbaCapture(first);
    assert.equal(serialized, canonicalJson(first));
    assert.deepEqual(parseRgbaCapture(serialized), first);
    assert.throws(() => parseRgbaCapture(`${serialized}\n`), /canonical JSON form/);
});

test("capture validation rejects premultiplication ambiguity, malformed bytes, and hash drift", () => {
    const valid = capture();
    assert.throws(() => createRgbaCapture({ width: 2, height: 1, rgba: new Uint8Array(7), environment: environment() }), /exactly 8 bytes/);
    assert.throws(() => createRgbaCapture({ width: 2, height: 1, rgba: new Uint8ClampedArray(8), environment: environment() }), /Uint8Array/);
    assert.throws(() => createRgbaCapture({ width: 2, height: 1, rgba: new Uint8Array(8), environment: environment({ fonts: { rasterizer: "x", manifestSha256: zeroHash }, surprise: true }) }), /exactly/);
    assert.throws(() => parseRgbaCapture(canonicalJson({ ...valid, alphaMode: "premultiplied" })), /straight-alpha/);
    assert.throws(() => parseRgbaCapture(canonicalJson({ ...valid, rgbaBase64: "!!!!" })), /canonical RFC 4648 base64/);
    assert.throws(() => parseRgbaCapture(canonicalJson({ ...valid, rgbaSha256: zeroHash })), /does not authenticate/);
    assert.throws(() => parseRgbaCapture(canonicalJson({ ...valid, captureSha256: zeroHash })), /does not authenticate/);
});

test("exact captures pass with zero metrics and a deterministic authenticated receipt", () => {
    const source = capture();
    const receipt = compareRgbaCaptures(source, capture());
    assert.equal(receipt.passed, true);
    assert.deepEqual(receipt.mismatchReasons, []);
    assert.deepEqual(receipt.diffBounds, null);
    assert.deepEqual(receipt.metrics, {
        differingPixels: 0,
        differingPixelRatio: 0,
        maxChannelDelta: 0,
        totalChannelDelta: 0,
        meanAbsoluteChannelDelta: 0,
        rootMeanSquareChannelDelta: 0,
        channelTotalDelta: { r: 0, g: 0, b: 0, a: 0 },
        channelMaxDelta: { r: 0, g: 0, b: 0, a: 0 },
    });
    assert.deepEqual(receipt.policy, EXACT_PIXEL_POLICY);
    assert.match(receipt.source.artifactSha256, /^[a-f0-9]{64}$/);
    assert.equal(serializePixelGoldenReceipt(receipt), canonicalJson(receipt));
    assert.deepEqual(receipt, compareRgbaCaptures(source, capture()));
});

test("straight-RGBA differences report exact metrics and the minimal pixel bounds", () => {
    const source = createRgbaCapture({ width: 3, height: 2, rgba: new Uint8Array(24), environment: environment() });
    const pixels = new Uint8Array(24);
    pixels.set([1, 2, 3, 4], (1 * 3 + 2) * 4);
    pixels[(0 * 3 + 1) * 4] = 5;
    const candidate = createRgbaCapture({ width: 3, height: 2, rgba: pixels, environment: environment() });
    const receipt = compareRgbaCaptures(source, candidate);
    assert.equal(receipt.passed, false);
    assert.deepEqual(receipt.diffBounds, { x: 1, y: 0, width: 2, height: 2 });
    assert.equal(receipt.metrics.differingPixels, 2);
    assert.equal(receipt.metrics.differingPixelRatio, 1 / 3);
    assert.equal(receipt.metrics.maxChannelDelta, 5);
    assert.equal(receipt.metrics.totalChannelDelta, 15);
    assert.equal(receipt.metrics.meanAbsoluteChannelDelta, 15 / 24);
    assert.equal(receipt.metrics.rootMeanSquareChannelDelta, Math.sqrt(55 / 24));
    assert.deepEqual(receipt.metrics.channelTotalDelta, { r: 6, g: 2, b: 3, a: 4 });
    assert.deepEqual(receipt.metrics.channelMaxDelta, { r: 5, g: 2, b: 3, a: 4 });
    assert.deepEqual(receipt.mismatchReasons, [
        "maxDifferingPixels", "maxDifferingPixelRatio", "maxChannelDelta",
        "maxMeanAbsoluteChannelDelta", "maxRootMeanSquareChannelDelta",
    ]);
});

test("environment and dimension mismatches fail closed and remain authenticated", () => {
    const source = capture();
    const otherEnvironment = capture(undefined, { environment: environment({ browser: { name: "Chromium", version: "129.0.0", revision: "r999" } }) });
    const environmentReceipt = compareRgbaCaptures(source, otherEnvironment, {
        maxDifferingPixels: 2, maxDifferingPixelRatio: 1, maxChannelDelta: 255,
        maxMeanAbsoluteChannelDelta: 255, maxRootMeanSquareChannelDelta: 255,
    });
    assert.equal(environmentReceipt.passed, false);
    assert.deepEqual(environmentReceipt.mismatchReasons, ["environment"]);
    assert.equal(environmentReceipt.metrics.differingPixels, 0);
    assert.notEqual(environmentReceipt.environmentSha256.source, environmentReceipt.environmentSha256.candidate);

    const differentDimensions = createRgbaCapture({ width: 1, height: 2, rgba: new Uint8Array(8), environment: environment() });
    const dimensionReceipt = compareRgbaCaptures(source, differentDimensions);
    assert.equal(dimensionReceipt.passed, false);
    assert.deepEqual(dimensionReceipt.mismatchReasons, ["dimensions"]);
    assert.equal(dimensionReceipt.metrics, null);
    assert.equal(dimensionReceipt.diffBounds, null);
    assert.deepEqual(dimensionReceipt.dimensions, { source: { width: 2, height: 1 }, candidate: { width: 1, height: 2 } });
});

test("policies are explicit, bounded, and cannot conceal an environment mismatch", () => {
    const permissive = {
        maxDifferingPixels: 2, maxDifferingPixelRatio: 1, maxChannelDelta: 255,
        maxMeanAbsoluteChannelDelta: 255, maxRootMeanSquareChannelDelta: 255,
    };
    assert.equal(compareRgbaCaptures(capture(), capture([255, 255, 255, 255, 255, 255, 255, 255]), permissive).passed, true);
    assert.throws(() => compareRgbaCaptures(capture(), capture(), { ...permissive, maxChannelDelta: 256 }), /at most 255/);
    assert.throws(() => compareRgbaCaptures(capture(), capture(), { ...permissive, untracked: 1 }), /exactly/);
});

test("the CLI writes canonical capture and receipt artifacts and exits nonzero on pixel drift", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-pixel-golden-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const environmentFile = path.join(root, "environment.json");
    const sourceRgba = path.join(root, "source.rgba");
    const candidateRgba = path.join(root, "candidate.rgba");
    const sourceCapture = path.join(root, "source.json");
    const candidateCapture = path.join(root, "candidate.json");
    const passReceipt = path.join(root, "pass.json");
    const failReceipt = path.join(root, "fail.json");
    fs.writeFileSync(environmentFile, canonicalJson(environment()));
    fs.writeFileSync(sourceRgba, Buffer.from([0, 0, 0, 0]));
    fs.writeFileSync(candidateRgba, Buffer.from([1, 0, 0, 0]));
    for (const [rgba, output] of [[sourceRgba, sourceCapture], [candidateRgba, candidateCapture]]) {
        const result = spawnSync(process.execPath, [cli, "capture", "--rgba", rgba, "--width", "1", "--height", "1", "--environment", environmentFile, "--output", output], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(parseRgbaCapture(fs.readFileSync(output, "utf8")), JSON.parse(fs.readFileSync(output, "utf8")));
    }
    const pass = spawnSync(process.execPath, [cli, "compare", "--source", sourceCapture, "--candidate", sourceCapture, "--receipt", passReceipt], { encoding: "utf8" });
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(JSON.parse(fs.readFileSync(passReceipt, "utf8")).passed, true);
    const fail = spawnSync(process.execPath, [cli, "compare", "--source", sourceCapture, "--candidate", candidateCapture, "--receipt", failReceipt], { encoding: "utf8" });
    assert.equal(fail.status, 1);
    assert.match(fail.stderr, /Pixel golden comparison failed/);
    assert.equal(JSON.parse(fs.readFileSync(failReceipt, "utf8")).passed, false);
});

test("the CLI rejects noncanonical input and unknown or duplicate options without a receipt", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-pixel-golden-invalid-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "source.json");
    const receipt = path.join(root, "receipt.json");
    fs.writeFileSync(source, JSON.stringify(capture()));
    const result = spawnSync(process.execPath, [cli, "compare", "--source", source, "--candidate", source, "--receipt", receipt], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /canonical JSON form/);
    assert.equal(fs.existsSync(receipt), false);
    const duplicate = spawnSync(process.execPath, [cli, "compare", "--source", source, "--source", source, "--candidate", source, "--receipt", receipt], { encoding: "utf8" });
    assert.equal(duplicate.status, 2);
    assert.match(duplicate.stderr, /Duplicate option/);
});
