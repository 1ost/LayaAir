"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
            target: ts.ScriptTarget.ES2019,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
        },
    });
    module._compile(output.outputText, filename);
};

const { createNativeBundleAssetBindings } = require("../../src/extensions/authoredContent/emit/NativeBundleAssetIdentity.ts");

function binding(bundleId) {
    return createNativeBundleAssetBindings(
        bundleId,
        "root.mc",
        [{ id: "bitmap", outputPath: "resources/bitmap.png" }],
        [{ semanticPath: "Root/Child", outputPath: "timelines/nested-1.mc" }],
    );
}

const first = binding("boot-shadow");
const second = binding("point-hp");
const ids = value => [value.timelineAssetId, ...value.resourceAssetIds.values(), ...value.nestedTimelineAssetIds.values()];
assert.deepEqual(ids(first), [
    "boot-shadow/root.mc",
    "boot-shadow/resources/bitmap.png",
    "boot-shadow/timelines/nested-1.mc",
]);
assert.deepEqual(ids(second), [
    "point-hp/root.mc",
    "point-hp/resources/bitmap.png",
    "point-hp/timelines/nested-1.mc",
]);
assert.equal(ids(first).some(value => ids(second).includes(value)), false, "two bundles shared a serialized asset UUID");
assert.equal(first.resourceAssetIds.get("bitmap"), "boot-shadow/resources/bitmap.png");
assert.equal(first.nestedTimelineAssetIds.get("Root/Child"), "boot-shadow/timelines/nested-1.mc");

for (const [label, invoke, expected] of [
    ["path traversal", () => createNativeBundleAssetBindings("bundle", "../root.mc", [], []), /AUTHORED_CONTENT_NATIVE_BUNDLE_PATH_INVALID/],
    ["duplicate serialized reference", () => createNativeBundleAssetBindings("bundle", "same.mc", [], [{ semanticPath: "Root", outputPath: "same.mc" }]), /AUTHORED_CONTENT_NATIVE_BUNDLE_ASSET_ID_COLLISION/],
]) assert.throws(invoke, expected, label);

process.stdout.write("authored bundle asset identity: 6/6 passed\n");
