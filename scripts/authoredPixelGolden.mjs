import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

export const AUTHORED_RGBA_CAPTURE_SCHEMA = "laya-authored-rgba-capture@1";
export const AUTHORED_PIXEL_GOLDEN_RECEIPT_SCHEMA = "laya-authored-pixel-golden-receipt@1";

export const EXACT_PIXEL_POLICY = Object.freeze({
    maxDifferingPixels: 0,
    maxDifferingPixelRatio: 0,
    maxChannelDelta: 0,
    maxMeanAbsoluteChannelDelta: 0,
    maxRootMeanSquareChannelDelta: 0,
});

const CAPTURE_KEYS = [
    "alphaMode", "captureSha256", "channelOrder", "colorSpace", "environment",
    "height", "rgbaBase64", "rgbaSha256", "rowOrder", "schema", "width",
];
const ENVIRONMENT_KEYS = ["backend", "browser", "fonts", "platform"];
const BROWSER_KEYS = ["name", "revision", "version"];
const BACKEND_KEYS = ["adapter", "api", "driver"];
const FONT_KEYS = ["manifestSha256", "rasterizer"];
const PLATFORM_KEYS = ["architecture", "devicePixelRatio", "os"];
const POLICY_KEYS = Object.keys(EXACT_PIXEL_POLICY).sort();
const RECEIPT_KEYS = [
    "candidate", "diffBounds", "dimensions", "environmentSha256", "metrics",
    "mismatchReasons", "passed", "policy", "receiptSha256", "schema", "source",
];
const IDENTITY_KEYS = ["artifactSha256", "captureSha256", "rgbaSha256"];
const METRIC_KEYS = [
    "channelMaxDelta", "channelTotalDelta", "differingPixelRatio", "differingPixels",
    "maxChannelDelta", "meanAbsoluteChannelDelta", "rootMeanSquareChannelDelta", "totalChannelDelta",
];
const CHANNEL_KEYS = ["a", "b", "g", "r"];
const MISMATCH_REASON_ORDER = [
    "dimensions", "environment", "maxDifferingPixels", "maxDifferingPixelRatio",
    "maxChannelDelta", "maxMeanAbsoluteChannelDelta", "maxRootMeanSquareChannelDelta",
];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function decodeExactUtf8(bytes, label) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`${label} must be bytes.`);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (error) { throw new TypeError(`${label} is not valid UTF-8: ${error.message}`); }
    if (!Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).equals(Buffer.from(text, "utf8"))) {
        throw new Error(`${label} is not exact BOM-free UTF-8.`);
    }
    return text;
}

function assertPlainObject(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(`${label} must be a plain object.`);
    }
}

function assertExactKeys(value, keys, label) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new TypeError(`${label} must contain exactly: ${expected.join(", ")}.`);
    }
}

function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
        throw new TypeError(`${label} must be a non-empty, surrounding-whitespace-free string.`);
    }
}

function assertSha256(value, label) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
    }
}

function assertUnsignedInteger(value, label, { positive = false } = {}) {
    if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
        throw new TypeError(`${label} must be a ${positive ? "positive" : "non-negative"} safe integer.`);
    }
}

function canonicalValue(value, location = "value") {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError(`${location} contains a non-finite number.`);
        return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, `${location}[${index}]`));
    assertPlainObject(value, location);
    const output = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] === undefined) throw new TypeError(`${location}.${key} is undefined.`);
        output[key] = canonicalValue(value[key], `${location}.${key}`);
    }
    return output;
}

export function canonicalJson(value) {
    return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function validateEnvironment(environment) {
    assertPlainObject(environment, "environment");
    assertExactKeys(environment, ENVIRONMENT_KEYS, "environment");
    for (const [name, keys] of [
        ["browser", BROWSER_KEYS], ["backend", BACKEND_KEYS], ["fonts", FONT_KEYS], ["platform", PLATFORM_KEYS],
    ]) {
        assertPlainObject(environment[name], `environment.${name}`);
        assertExactKeys(environment[name], keys, `environment.${name}`);
    }
    for (const key of BROWSER_KEYS) assertNonEmptyString(environment.browser[key], `environment.browser.${key}`);
    for (const key of BACKEND_KEYS) assertNonEmptyString(environment.backend[key], `environment.backend.${key}`);
    assertNonEmptyString(environment.fonts.rasterizer, "environment.fonts.rasterizer");
    assertSha256(environment.fonts.manifestSha256, "environment.fonts.manifestSha256");
    assertNonEmptyString(environment.platform.os, "environment.platform.os");
    assertNonEmptyString(environment.platform.architecture, "environment.platform.architecture");
    if (!Number.isFinite(environment.platform.devicePixelRatio) || environment.platform.devicePixelRatio <= 0) {
        throw new TypeError("environment.platform.devicePixelRatio must be a positive finite number.");
    }
    return canonicalValue(environment, "environment");
}

function captureBody(capture) {
    const { captureSha256: _captureSha256, ...body } = capture;
    return body;
}

function decodeCanonicalBase64(value) {
    if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new TypeError("rgbaBase64 must be non-empty canonical RFC 4648 base64.");
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) throw new TypeError("rgbaBase64 is not canonical base64.");
    return bytes;
}

export function createRgbaCapture({ width, height, rgba, environment }) {
    assertUnsignedInteger(width, "width", { positive: true });
    assertUnsignedInteger(height, "height", { positive: true });
    if (!(rgba instanceof Uint8Array)) throw new TypeError("rgba must be a Uint8Array.");
    const expectedLength = width * height * 4;
    if (!Number.isSafeInteger(expectedLength) || rgba.byteLength !== expectedLength) {
        throw new RangeError(`rgba must contain exactly ${expectedLength} bytes for ${width}x${height} straight RGBA.`);
    }
    const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const capture = {
        schema: AUTHORED_RGBA_CAPTURE_SCHEMA,
        width,
        height,
        colorSpace: "srgb",
        alphaMode: "straight",
        channelOrder: "rgba",
        rowOrder: "top-to-bottom",
        environment: validateEnvironment(environment),
        rgbaSha256: sha256(pixels),
        rgbaBase64: pixels.toString("base64"),
    };
    return { ...capture, captureSha256: sha256(canonicalJson(capture)) };
}

export function validateRgbaCapture(capture) {
    assertPlainObject(capture, "capture");
    assertExactKeys(capture, CAPTURE_KEYS, "capture");
    if (capture.schema !== AUTHORED_RGBA_CAPTURE_SCHEMA) throw new TypeError(`capture.schema must be ${AUTHORED_RGBA_CAPTURE_SCHEMA}.`);
    assertUnsignedInteger(capture.width, "capture.width", { positive: true });
    assertUnsignedInteger(capture.height, "capture.height", { positive: true });
    if (capture.colorSpace !== "srgb" || capture.alphaMode !== "straight"
        || capture.channelOrder !== "rgba" || capture.rowOrder !== "top-to-bottom") {
        throw new TypeError("capture must be sRGB, straight-alpha, RGBA, top-to-bottom pixel data.");
    }
    validateEnvironment(capture.environment);
    assertSha256(capture.rgbaSha256, "capture.rgbaSha256");
    assertSha256(capture.captureSha256, "capture.captureSha256");
    const rgba = decodeCanonicalBase64(capture.rgbaBase64);
    const expectedLength = capture.width * capture.height * 4;
    if (!Number.isSafeInteger(expectedLength) || rgba.byteLength !== expectedLength) {
        throw new RangeError(`capture.rgbaBase64 must decode to exactly ${expectedLength} bytes.`);
    }
    if (sha256(rgba) !== capture.rgbaSha256) throw new Error("capture.rgbaSha256 does not authenticate rgbaBase64.");
    if (sha256(canonicalJson(captureBody(capture))) !== capture.captureSha256) {
        throw new Error("capture.captureSha256 does not authenticate the canonical capture body.");
    }
    return rgba;
}

export function serializeRgbaCapture(capture) {
    validateRgbaCapture(capture);
    return canonicalJson(capture);
}

export function parseRgbaCapture(text, label = "capture artifact") {
    if (typeof text !== "string") throw new TypeError(`${label} must be UTF-8 text.`);
    let capture;
    try { capture = JSON.parse(text); }
    catch (error) { throw new SyntaxError(`${label} is not valid JSON: ${error.message}`); }
    validateRgbaCapture(capture);
    if (text !== canonicalJson(capture)) throw new Error(`${label} is not in canonical JSON form.`);
    return capture;
}

export function parseRgbaCaptureBytes(bytes, label = "capture artifact") {
    return parseRgbaCapture(decodeExactUtf8(bytes, label), label);
}

function validatePolicy(policy) {
    assertPlainObject(policy, "policy");
    assertExactKeys(policy, POLICY_KEYS, "policy");
    assertUnsignedInteger(policy.maxDifferingPixels, "policy.maxDifferingPixels");
    for (const key of POLICY_KEYS.filter(key => key !== "maxDifferingPixels")) {
        if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new TypeError(`policy.${key} must be a non-negative finite number.`);
    }
    if (policy.maxDifferingPixelRatio > 1 || policy.maxChannelDelta > 255
        || policy.maxMeanAbsoluteChannelDelta > 255 || policy.maxRootMeanSquareChannelDelta > 255) {
        throw new RangeError("pixel ratio must be at most 1 and channel metrics at most 255.");
    }
    return canonicalValue(policy, "policy");
}

function assertNonNegativeFinite(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a non-negative finite number.`);
}

function validateIdentity(identity, label) {
    assertPlainObject(identity, label);
    assertExactKeys(identity, IDENTITY_KEYS, label);
    for (const key of IDENTITY_KEYS) assertSha256(identity[key], `${label}.${key}`);
}

function assertMetricSafeDimensions(dimensions, label) {
    const maximumTotalDelta = dimensions.width * dimensions.height * 4 * 255;
    if (!Number.isSafeInteger(maximumTotalDelta)) {
        throw new RangeError(`${label} is too large for exact integer pixel metrics.`);
    }
}

function validateDimensions(dimensions) {
    assertPlainObject(dimensions, "receipt.dimensions");
    const keys = Object.keys(dimensions).sort();
    if (keys.length === 2 && keys[0] === "height" && keys[1] === "width") {
        assertUnsignedInteger(dimensions.width, "receipt.dimensions.width", { positive: true });
        assertUnsignedInteger(dimensions.height, "receipt.dimensions.height", { positive: true });
        assertMetricSafeDimensions(dimensions, "receipt.dimensions");
        return { matches: true, width: dimensions.width, height: dimensions.height };
    }
    assertExactKeys(dimensions, ["candidate", "source"], "receipt.dimensions");
    for (const side of ["source", "candidate"]) {
        assertPlainObject(dimensions[side], `receipt.dimensions.${side}`);
        assertExactKeys(dimensions[side], ["height", "width"], `receipt.dimensions.${side}`);
        assertUnsignedInteger(dimensions[side].width, `receipt.dimensions.${side}.width`, { positive: true });
        assertUnsignedInteger(dimensions[side].height, `receipt.dimensions.${side}.height`, { positive: true });
        assertMetricSafeDimensions(dimensions[side], `receipt.dimensions.${side}`);
    }
    if (dimensions.source.width === dimensions.candidate.width && dimensions.source.height === dimensions.candidate.height) {
        throw new Error("receipt.dimensions mismatch form requires different source and candidate dimensions.");
    }
    return { matches: false };
}

function validateEnvironmentIdentity(environmentSha256) {
    if (typeof environmentSha256 === "string") {
        assertSha256(environmentSha256, "receipt.environmentSha256");
        return true;
    }
    assertPlainObject(environmentSha256, "receipt.environmentSha256");
    assertExactKeys(environmentSha256, ["candidate", "source"], "receipt.environmentSha256");
    assertSha256(environmentSha256.source, "receipt.environmentSha256.source");
    assertSha256(environmentSha256.candidate, "receipt.environmentSha256.candidate");
    if (environmentSha256.source === environmentSha256.candidate) {
        throw new Error("receipt.environmentSha256 mismatch form requires different identities.");
    }
    return false;
}

function validateChannelMetrics(channels, label, maximum) {
    assertPlainObject(channels, label);
    assertExactKeys(channels, CHANNEL_KEYS, label);
    for (const channel of CHANNEL_KEYS) {
        assertUnsignedInteger(channels[channel], `${label}.${channel}`);
        if (channels[channel] > maximum) throw new RangeError(`${label}.${channel} exceeds its image bound.`);
    }
}

function validateMetrics(metrics, width, height) {
    assertPlainObject(metrics, "receipt.metrics");
    assertExactKeys(metrics, METRIC_KEYS, "receipt.metrics");
    const pixels = width * height;
    assertUnsignedInteger(metrics.differingPixels, "receipt.metrics.differingPixels");
    assertUnsignedInteger(metrics.maxChannelDelta, "receipt.metrics.maxChannelDelta");
    assertUnsignedInteger(metrics.totalChannelDelta, "receipt.metrics.totalChannelDelta");
    if (metrics.differingPixels > pixels || metrics.maxChannelDelta > 255
        || metrics.totalChannelDelta > pixels * 4 * 255) {
        throw new RangeError("receipt.metrics exceeds its image or channel bounds.");
    }
    for (const key of ["differingPixelRatio", "meanAbsoluteChannelDelta", "rootMeanSquareChannelDelta"]) {
        assertNonNegativeFinite(metrics[key], `receipt.metrics.${key}`);
    }
    if (metrics.differingPixelRatio > 1 || metrics.meanAbsoluteChannelDelta > 255
        || metrics.rootMeanSquareChannelDelta > 255) {
        throw new RangeError("receipt.metrics normalized values exceed their natural bounds.");
    }
    if (metrics.differingPixelRatio !== metrics.differingPixels / pixels) {
        throw new Error("receipt.metrics.differingPixelRatio is inconsistent with differingPixels.");
    }
    validateChannelMetrics(metrics.channelMaxDelta, "receipt.metrics.channelMaxDelta", 255);
    validateChannelMetrics(metrics.channelTotalDelta, "receipt.metrics.channelTotalDelta", pixels * 255);
    if (Object.values(metrics.channelTotalDelta).reduce((sum, value) => sum + value, 0) !== metrics.totalChannelDelta
        || Math.max(...Object.values(metrics.channelMaxDelta)) !== metrics.maxChannelDelta) {
        throw new Error("receipt channel metrics are inconsistent with aggregate metrics.");
    }
}

function validateDiffBounds(diffBounds, metrics, width, height) {
    if (diffBounds === null) {
        if (metrics.differingPixels !== 0) throw new Error("receipt.diffBounds is required when pixels differ.");
        return;
    }
    assertPlainObject(diffBounds, "receipt.diffBounds");
    assertExactKeys(diffBounds, ["height", "width", "x", "y"], "receipt.diffBounds");
    assertUnsignedInteger(diffBounds.x, "receipt.diffBounds.x");
    assertUnsignedInteger(diffBounds.y, "receipt.diffBounds.y");
    assertUnsignedInteger(diffBounds.width, "receipt.diffBounds.width", { positive: true });
    assertUnsignedInteger(diffBounds.height, "receipt.diffBounds.height", { positive: true });
    if (metrics.differingPixels === 0 || diffBounds.x + diffBounds.width > width || diffBounds.y + diffBounds.height > height) {
        throw new RangeError("receipt.diffBounds is inconsistent with the image or pixel metrics.");
    }
}

function expectedThresholdReasons(metrics, policy) {
    const reasons = [];
    if (metrics.differingPixels > policy.maxDifferingPixels) reasons.push("maxDifferingPixels");
    if (metrics.differingPixelRatio > policy.maxDifferingPixelRatio) reasons.push("maxDifferingPixelRatio");
    if (metrics.maxChannelDelta > policy.maxChannelDelta) reasons.push("maxChannelDelta");
    if (metrics.meanAbsoluteChannelDelta > policy.maxMeanAbsoluteChannelDelta) reasons.push("maxMeanAbsoluteChannelDelta");
    if (metrics.rootMeanSquareChannelDelta > policy.maxRootMeanSquareChannelDelta) reasons.push("maxRootMeanSquareChannelDelta");
    return reasons;
}

export function validatePixelGoldenReceipt(receipt) {
    assertPlainObject(receipt, "receipt");
    assertExactKeys(receipt, RECEIPT_KEYS, "receipt");
    if (receipt.schema !== AUTHORED_PIXEL_GOLDEN_RECEIPT_SCHEMA) {
        throw new TypeError(`receipt.schema must be ${AUTHORED_PIXEL_GOLDEN_RECEIPT_SCHEMA}.`);
    }
    validateIdentity(receipt.source, "receipt.source");
    validateIdentity(receipt.candidate, "receipt.candidate");
    const dimensions = validateDimensions(receipt.dimensions);
    const environmentMatches = validateEnvironmentIdentity(receipt.environmentSha256);
    const policy = validatePolicy(receipt.policy);
    if (!Array.isArray(receipt.mismatchReasons)) throw new TypeError("receipt.mismatchReasons must be an array.");
    let previousReasonIndex = -1;
    for (const reason of receipt.mismatchReasons) {
        const index = MISMATCH_REASON_ORDER.indexOf(reason);
        if (index < 0 || index <= previousReasonIndex) throw new Error("receipt.mismatchReasons must be unique and in canonical order.");
        previousReasonIndex = index;
    }
    if (typeof receipt.passed !== "boolean" || receipt.passed !== (receipt.mismatchReasons.length === 0)) {
        throw new Error("receipt.passed must exactly reflect mismatchReasons.");
    }
    const structuralReasons = [];
    if (!dimensions.matches) structuralReasons.push("dimensions");
    if (!environmentMatches) structuralReasons.push("environment");
    if (!dimensions.matches) {
        if (receipt.metrics !== null || receipt.diffBounds !== null) {
            throw new Error("dimension-mismatch receipts cannot contain pixel metrics or diff bounds.");
        }
    } else {
        validateMetrics(receipt.metrics, dimensions.width, dimensions.height);
        validateDiffBounds(receipt.diffBounds, receipt.metrics, dimensions.width, dimensions.height);
        structuralReasons.push(...expectedThresholdReasons(receipt.metrics, policy));
    }
    if (canonicalJson(structuralReasons) !== canonicalJson(receipt.mismatchReasons)) {
        throw new Error("receipt.mismatchReasons is inconsistent with dimensions, environment, metrics, or policy.");
    }
    assertSha256(receipt.receiptSha256, "receipt.receiptSha256");
    const { receiptSha256, ...body } = receipt;
    if (sha256(canonicalJson(body)) !== receiptSha256) throw new Error("receipt.receiptSha256 does not authenticate the receipt body.");
    return receipt;
}

function artifactIdentity(capture) {
    const artifact = canonicalJson(capture);
    return {
        artifactSha256: sha256(artifact),
        captureSha256: capture.captureSha256,
        rgbaSha256: capture.rgbaSha256,
    };
}

function calculateMetrics(source, candidate, width, height) {
    let differingPixels = 0;
    let totalChannelDelta = 0;
    let squaredChannelDelta = 0;
    let maxChannelDelta = 0;
    const channelTotalDelta = { r: 0, g: 0, b: 0, a: 0 };
    const channelMaxDelta = { r: 0, g: 0, b: 0, a: 0 };
    const channels = ["r", "g", "b", "a"];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel++) {
        let pixelDiffers = false;
        for (let channel = 0; channel < 4; channel++) {
            const delta = Math.abs(source[pixel * 4 + channel] - candidate[pixel * 4 + channel]);
            if (delta !== 0) pixelDiffers = true;
            totalChannelDelta += delta;
            squaredChannelDelta += delta * delta;
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            channelTotalDelta[channels[channel]] += delta;
            channelMaxDelta[channels[channel]] = Math.max(channelMaxDelta[channels[channel]], delta);
        }
        if (pixelDiffers) {
            differingPixels++;
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
    }
    const channelCount = width * height * 4;
    return {
        metrics: {
            differingPixels,
            differingPixelRatio: differingPixels / (width * height),
            maxChannelDelta,
            totalChannelDelta,
            meanAbsoluteChannelDelta: totalChannelDelta / channelCount,
            rootMeanSquareChannelDelta: Math.sqrt(squaredChannelDelta / channelCount),
            channelTotalDelta,
            channelMaxDelta,
        },
        diffBounds: differingPixels === 0 ? null : {
            x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1,
        },
    };
}

export function compareRgbaCaptures(sourceCapture, candidateCapture, policy = EXACT_PIXEL_POLICY) {
    const source = validateRgbaCapture(sourceCapture);
    const candidate = validateRgbaCapture(candidateCapture);
    const checkedPolicy = validatePolicy(policy);
    const dimensionsMatch = sourceCapture.width === candidateCapture.width && sourceCapture.height === candidateCapture.height;
    const sourceEnvironment = canonicalJson(sourceCapture.environment);
    const candidateEnvironment = canonicalJson(candidateCapture.environment);
    const environmentMatch = sourceEnvironment === candidateEnvironment;
    const mismatchReasons = [];
    if (!dimensionsMatch) mismatchReasons.push("dimensions");
    if (!environmentMatch) mismatchReasons.push("environment");
    let metrics = null;
    let diffBounds = null;
    if (dimensionsMatch) ({ metrics, diffBounds } = calculateMetrics(source, candidate, sourceCapture.width, sourceCapture.height));
    if (metrics) {
        if (metrics.differingPixels > checkedPolicy.maxDifferingPixels) mismatchReasons.push("maxDifferingPixels");
        if (metrics.differingPixelRatio > checkedPolicy.maxDifferingPixelRatio) mismatchReasons.push("maxDifferingPixelRatio");
        if (metrics.maxChannelDelta > checkedPolicy.maxChannelDelta) mismatchReasons.push("maxChannelDelta");
        if (metrics.meanAbsoluteChannelDelta > checkedPolicy.maxMeanAbsoluteChannelDelta) mismatchReasons.push("maxMeanAbsoluteChannelDelta");
        if (metrics.rootMeanSquareChannelDelta > checkedPolicy.maxRootMeanSquareChannelDelta) mismatchReasons.push("maxRootMeanSquareChannelDelta");
    }
    const receipt = {
        schema: AUTHORED_PIXEL_GOLDEN_RECEIPT_SCHEMA,
        source: artifactIdentity(sourceCapture),
        candidate: artifactIdentity(candidateCapture),
        dimensions: dimensionsMatch ? { width: sourceCapture.width, height: sourceCapture.height } : {
            source: { width: sourceCapture.width, height: sourceCapture.height },
            candidate: { width: candidateCapture.width, height: candidateCapture.height },
        },
        environmentSha256: environmentMatch ? sha256(sourceEnvironment) : {
            source: sha256(sourceEnvironment), candidate: sha256(candidateEnvironment),
        },
        policy: checkedPolicy,
        metrics,
        diffBounds,
        mismatchReasons,
        passed: mismatchReasons.length === 0,
    };
    return { ...receipt, receiptSha256: sha256(canonicalJson(receipt)) };
}

export function serializePixelGoldenReceipt(receipt) {
    validatePixelGoldenReceipt(receipt);
    return canonicalJson(receipt);
}

export function parsePixelGoldenReceipt(text, label = "pixel golden receipt artifact") {
    if (typeof text !== "string") throw new TypeError(`${label} must be UTF-8 text.`);
    let receipt;
    try { receipt = JSON.parse(text); }
    catch (error) { throw new SyntaxError(`${label} is not valid JSON: ${error.message}`); }
    validatePixelGoldenReceipt(receipt);
    if (text !== canonicalJson(receipt)) throw new Error(`${label} is not in canonical JSON form.`);
    return receipt;
}

export function parsePixelGoldenReceiptBytes(bytes, label = "pixel golden receipt artifact") {
    return parsePixelGoldenReceipt(decodeExactUtf8(bytes, label), label);
}

function writeFileAtomic(destination, content) {
    const resolved = path.resolve(destination);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const temporary = `${resolved}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
        fs.renameSync(temporary, resolved);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

function parseOptions(args, allowed) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith("--") || value === undefined) throw new Error(`Expected --name value pairs; received ${key ?? "end of arguments"}.`);
        const name = key.slice(2);
        if (!allowed.includes(name)) throw new Error(`Unknown option --${name}.`);
        if (Object.hasOwn(options, name)) throw new Error(`Duplicate option --${name}.`);
        options[name] = value;
    }
    for (const name of allowed.filter(name => name !== "policy")) {
        if (!Object.hasOwn(options, name)) throw new Error(`Missing required option --${name}.`);
    }
    return options;
}

function readCanonicalJson(file, label) {
    const text = decodeExactUtf8(fs.readFileSync(file), label);
    let value;
    try { value = JSON.parse(text); }
    catch (error) { throw new SyntaxError(`${label} is not valid JSON: ${error.message}`); }
    if (text !== canonicalJson(value)) throw new Error(`${label} is not in canonical JSON form.`);
    return value;
}

export function runAuthoredPixelGoldenCli(args) {
    const [command, ...rest] = args;
    if (command === "capture") {
        const options = parseOptions(rest, ["rgba", "width", "height", "environment", "output"]);
        const rgba = fs.readFileSync(options.rgba);
        const environment = readCanonicalJson(options.environment, "environment artifact");
        const capture = createRgbaCapture({ width: Number(options.width), height: Number(options.height), rgba, environment });
        writeFileAtomic(options.output, serializeRgbaCapture(capture));
        return { exitCode: 0, capture };
    }
    if (command === "compare") {
        const options = parseOptions(rest, ["source", "candidate", "receipt", "policy"]);
        const source = parseRgbaCaptureBytes(fs.readFileSync(options.source), "source capture artifact");
        const candidate = parseRgbaCaptureBytes(fs.readFileSync(options.candidate), "candidate capture artifact");
        const policy = options.policy ? readCanonicalJson(options.policy, "pixel policy artifact") : EXACT_PIXEL_POLICY;
        const receipt = compareRgbaCaptures(source, candidate, policy);
        writeFileAtomic(options.receipt, serializePixelGoldenReceipt(receipt));
        return { exitCode: receipt.passed ? 0 : 1, receipt };
    }
    throw new Error("Usage: authoredPixelGolden.mjs capture|compare [--name value ...]");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    try {
        const result = runAuthoredPixelGoldenCli(process.argv.slice(2));
        if (!result.receipt?.passed && result.receipt) process.stderr.write(`Pixel golden comparison failed: ${result.receipt.mismatchReasons.join(", ")}\n`);
        process.exitCode = result.exitCode;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
    }
}
