import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    AUTHORED_IMAGE_PUBLISH_SCHEMA,
    LOCALIZED_MEDIA_MAP_SCHEMA,
    createAuthoredImagePublishPlan,
    publishAuthoredImages,
} from "../../src/extensions/authoredContent/publish/AuthoredImagePublishPipeline.ts";
import {
    createLayaAtlasPreviewLoader,
    verifyAuthoredImageNativePreview,
} from "../../src/extensions/authoredContent/publish/LayaAtlasPreviewVerifier.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const digest = character => character.repeat(64);

function loadRepositoryTypeScript() {
    const candidates = [resolve(repositoryRoot, "node_modules/typescript/lib/typescript.js")];
    const dotGit = resolve(repositoryRoot, ".git");
    if (!existsSync(candidates[0]) && existsSync(dotGit)) {
        const contents = readFileSync(dotGit, "utf8").trim();
        if (contents.startsWith("gitdir:")) {
            const linkedGitDir = resolve(repositoryRoot, contents.substring("gitdir:".length).trim());
            const commonGitDir = resolve(linkedGitDir, "../..");
            candidates.push(resolve(dirname(commonGitDir), "node_modules/typescript/lib/typescript.js"));
        }
    }
    const compilerPath = candidates.find(existsSync);
    if (!compilerPath)
        throw new Error("The repository TypeScript devDependency is required for the real AtlasLoader round-trip");
    return createRequire(import.meta.url)(compilerPath);
}

const ts = loadRepositoryTypeScript();

// LayaAir TypeScript uses extensionless relative specifiers. This test-only
// resolver uses the repository compiler to execute the actual AtlasLoader.
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
            if (/\.(?:vs|fs|glsl|wgsl)$/.test(specifier)) {
                const shaderUrl = new URL(specifier, context.parentURL);
                if (existsSync(fileURLToPath(shaderUrl)))
                    return { url: shaderUrl.href, shortCircuit: true };
                // Some optional shader sources are absent from this checkout.
                // They are unrelated to AtlasLoader metadata execution.
                return { url: "data:text/javascript,export default '';", shortCircuit: true };
            }
            const unresolved = fileURLToPath(new URL(specifier, context.parentURL));
            for (const candidate of [`${unresolved}.ts`, join(unresolved, "index.ts")]) {
                if (existsSync(candidate))
                    return { url: pathToFileURL(candidate).href, shortCircuit: true };
            }
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.endsWith(".ts")) {
            return {
                format: "module",
                shortCircuit: true,
                source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
                    compilerOptions: {
                        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
                        module: ts.ModuleKind.ESNext,
                        sourceMap: false,
                        target: ts.ScriptTarget.ES2020,
                    },
                    fileName: fileURLToPath(url),
                }).outputText,
            };
        }
        if (/\.(?:vs|fs|glsl|wgsl)$/.test(url)) {
            return {
                format: "module",
                shortCircuit: true,
                source: `export default ${JSON.stringify(readFileSync(new URL(url), "utf8"))};`,
            };
        }
        return nextLoad(url, context);
    },
});

function source(uuid, mediaKey, overrides = {}) {
    return {
        uuid,
        mediaKey,
        sourcePath: `authoring/images/${uuid}.png`,
        sourceSha256: digest("a"),
        width: 28,
        height: 20,
        lifecycle: "scene",
        ownership: { kind: "common" },
        sampler: { filter: "linear", mipmaps: false },
        alpha: "straight",
        colorSpace: "srgb",
        compression: "png",
        repeat: "clamp",
        ...overrides,
    };
}

const inventory = [
    source("hero-common-0001", "ui/hero"),
    source("hero-fr-FR-00001", "ui/hero", { ownership: { kind: "locale", locale: "fr-fr" } }),
    source("logo-common-0001", "ui/logo", { lifecycle: "bootstrap", alpha: "opaque" }),
    source("normal-common-001", "maps/normal", { colorSpace: "linear", compression: "ktx1" }),
    source("repeat-common-001", "maps/repeat", { repeat: "repeat", sampler: { filter: "nearest", mipmaps: true } }),
    source("large-fr-FR-0001", "ui/splash", {
        ownership: { kind: "locale", locale: "fr-FR" },
        width: 128,
        height: 32,
    }),
];

const localizedMedia = [
    { mediaKey: "ui/hero", common: "hero-common-0001", locales: { "fr-FR": "hero-fr-FR-00001" } },
    { mediaKey: "ui/logo", common: "logo-common-0001" },
    { mediaKey: "maps/normal", common: "normal-common-001" },
    { mediaKey: "maps/repeat", common: "repeat-common-001" },
    { mediaKey: "ui/splash", locales: { "fr-fr": "large-fr-FR-0001" } },
];

test("module file inventory is exact and the root script keeps the gate runnable", async () => {
    const publishRoot = resolve(repositoryRoot, "src/extensions/authoredContent/publish");
    const files = (await readdir(publishRoot, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .sort();
    assert.deepEqual(files, [
        "AuthoredImagePublishPipeline.ts",
        "LayaAtlasPreviewVerifier.ts",
        "README.md",
        "index.ts",
    ]);
    const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
    assert.equal(
        packageJson.scripts["test:authored-image-publish"],
        "node --experimental-strip-types --test tests/authoredImagePublish/authored-image-publish.test.mjs",
    );
});

test("shuffled loose inventory produces byte-identical deterministic plans", () => {
    const forward = createAuthoredImagePublishPlan(inventory, localizedMedia, { maxAtlasSize: 64, padding: 0 });
    const reverse = createAuthoredImagePublishPlan([...inventory].reverse(), [...localizedMedia].reverse(), { maxAtlasSize: 64, padding: 0 });
    assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
    assert.equal(forward.schema, AUTHORED_IMAGE_PUBLISH_SCHEMA);
    assert.equal(forward.localizedMediaMap.schema, LOCALIZED_MEDIA_MAP_SCHEMA);
    assert.equal(forward.localizedMediaMap.entries["ui/hero"].locales["fr-FR"], "hero-fr-FR-00001");
    assert.deepEqual(forward.sources.map(item => item.uuid), [...forward.sources.map(item => item.uuid)].sort());
    assert.ok(Object.isFrozen(forward));
    assert.ok(Object.isFrozen(forward.sources));
    assert.ok(Object.isFrozen(forward.sources[0]));
    assert.ok(Object.isFrozen(forward.sources[0].ownership));
    assert.ok(Object.isFrozen(forward.atlases[0].pages[0].placements));
    assert.ok(Object.isFrozen(forward.localizedMediaMap.entries["ui/hero"].locales));
});

test("nested caller extras and cycles are projected out without freezing caller authority", async () => {
    const samplerLeft = { filter: "linear", mipmaps: false };
    samplerLeft.zeta = { ignored: true };
    samplerLeft.alpha = "ignored";
    samplerLeft.self = samplerLeft;
    const samplerRight = { filter: "linear", mipmaps: false };
    samplerRight.alpha = "different ignored value";
    samplerRight.self = samplerRight;
    samplerRight.zeta = { ignored: false };
    const ownershipLeft = { kind: "common", ignored: { nested: true } };
    const ownershipRight = { ignored: { nested: false }, kind: "common" };
    const leftSource = source("project-common-001", "project", {
        sampler: samplerLeft,
        ownership: ownershipLeft,
        ignoredTopLevel: { self: null },
    });
    leftSource.ignoredTopLevel.self = leftSource.ignoredTopLevel;
    const rightSource = source("project-common-001", "project", {
        ignoredTopLevel: { value: "different" },
        ownership: ownershipRight,
        sampler: samplerRight,
    });
    const leftDeclaration = { mediaKey: "project", common: "project-common-001", ignored: { value: 1 } };
    const rightDeclaration = { ignored: { value: 2 }, common: "project-common-001", mediaKey: "project" };
    const leftOptions = { maxAtlasSize: 64, padding: 1, ignored: { value: 1 } };
    const rightOptions = { ignored: { value: 2 }, padding: 1, maxAtlasSize: 64 };

    const left = createAuthoredImagePublishPlan([leftSource], [leftDeclaration], leftOptions);
    const right = createAuthoredImagePublishPlan([rightSource], [rightDeclaration], rightOptions);
    assert.equal(JSON.stringify(left), JSON.stringify(right));
    assert.deepEqual(left.sources[0].sampler, { filter: "linear", mipmaps: false });
    assert.deepEqual(left.sources[0].ownership, { kind: "common" });
    assert.equal("ignoredTopLevel" in left.sources[0], false);
    for (const callerObject of [
        samplerLeft,
        samplerLeft.zeta,
        ownershipLeft,
        ownershipLeft.ignored,
        leftSource,
        leftSource.ignoredTopLevel,
        leftDeclaration,
        leftDeclaration.ignored,
        leftOptions,
        leftOptions.ignored,
    ]) {
        assert.equal(Object.isFrozen(callerObject), false);
    }

    const receipt = await publishAuthoredImages(left, {
        async writeAtlasPage(page, sources) {
            assert.equal(sources[0].uuid, "project-common-001");
            return { outputPath: page.outputPath, width: page.width, height: page.height, sha256: digest("9") };
        },
        async writeLooseImage() { throw new Error("unexpected"); },
        async writeTextFile() {},
    });
    assert.deepEqual(receipt.files.map(file => file.path), left.outputFiles);
});

test("atlas groups never cross lifecycle, locale, sampler, alpha, color, compression, or repeat policy", () => {
    const plan = createAuthoredImagePublishPlan(inventory, localizedMedia, { maxAtlasSize: 64, padding: 0 });
    assert.equal(plan.atlases.length, 4);
    assert.ok(plan.atlases.some(atlas => atlas.ownership.kind === "locale" && atlas.ownership.locale === "fr-FR"));
    assert.ok(plan.atlases.every(atlas => atlas.repeat === "clamp"));
    assert.ok(plan.atlases.every(atlas => atlas.manifest.meta.prefix === "res://"));
    assert.deepEqual(
        plan.looseImages.map(item => [item.uuid, item.reason]),
        [["repeat-common-001", "repeat-policy"], ["large-fr-FR-0001", "oversized"]],
    );
    const frame = plan.atlases.flatMap(atlas => Object.values(atlas.manifest.frames)).find(value => value.filename === "hero-common-0001");
    assert.equal(frame.filename, "hero-common-0001");
    assert.equal(frame.sourceSize.w, 28);
});

test("shelf packing is stable across pages and accounts for filter and mip padding", () => {
    const packed = Array.from({ length: 6 }, (_, index) => source(
        `tile-common-000${index}`,
        `tile/${index}`,
        { width: 30, height: 30, sampler: { filter: "linear", mipmaps: true } },
    ));
    const declarations = packed.map(item => ({ mediaKey: item.mediaKey, common: item.uuid }));
    const plan = createAuthoredImagePublishPlan(packed, declarations, { maxAtlasSize: 64, padding: 0 });
    assert.equal(plan.atlases.length, 1);
    assert.equal(plan.atlases[0].pages.length, 6);
    assert.ok(plan.atlases[0].pages.every(page => page.width === 64 && page.height === 64));
    assert.ok(plan.atlases[0].pages.every(page => page.placements[0].padding === 2));
    assert.deepEqual(plan.atlases[0].pages.map(page => page.index), [0, 1, 2, 3, 4, 5]);
});

test("explicit locale maps are exhaustive and reject implicit fallback", () => {
    assert.throws(
        () => createAuthoredImagePublishPlan(inventory, localizedMedia.filter(entry => entry.mediaKey !== "ui/splash"), { maxAtlasSize: 64, padding: 1 }),
        /absent from the explicit localized media map/,
    );
    assert.throws(
        () => createAuthoredImagePublishPlan(inventory, localizedMedia.map(entry => entry.mediaKey === "ui/hero"
            ? { ...entry, locales: { "de-DE": "hero-fr-FR-00001" } }
            : entry), { maxAtlasSize: 64, padding: 1 }),
        /does not name its locale-owned source/,
    );
});

test("authoring inputs reject atlas paths, duplicate UUIDs, and unstable inventory metadata", () => {
    assert.throws(
        () => createAuthoredImagePublishPlan([source("bad-atlas-uuid01", "bad", { sourcePath: "published/atlases/bad.png" })], [{ mediaKey: "bad", common: "bad-atlas-uuid01" }], { maxAtlasSize: 64, padding: 1 }),
        /loose authoring file/,
    );
    assert.throws(
        () => createAuthoredImagePublishPlan([inventory[0], { ...inventory[0], sourcePath: "authoring/images/other.png" }], localizedMedia, { maxAtlasSize: 64, padding: 1 }),
        /duplicate UUID/,
    );
    assert.throws(
        () => createAuthoredImagePublishPlan([{ ...inventory[0], sourceSha256: "not-a-digest" }], [{ mediaKey: "ui/hero", common: "hero-common-0001" }], { maxAtlasSize: 64, padding: 1 }),
        /lowercase SHA-256/,
    );
});

test("publish writer receives the exact plan and emits a sorted file receipt", async () => {
    const plan = createAuthoredImagePublishPlan(inventory, localizedMedia, { maxAtlasSize: 64, padding: 1 });
    const textFiles = new Map();
    const writer = {
        async writeAtlasPage(page, sources) {
            assert.deepEqual(sources.map(item => item.uuid), page.placements.map(item => item.uuid));
            return { outputPath: page.outputPath, width: page.width, height: page.height, sha256: digest("b") };
        },
        async writeLooseImage(image, item) {
            assert.equal(image.uuid, item.uuid);
            return { outputPath: image.outputPath, sha256: digest("c") };
        },
        async writeTextFile(path, contents) {
            textFiles.set(path, contents);
        },
    };
    const receipt = await publishAuthoredImages(plan, writer);
    assert.deepEqual(receipt.files.map(file => file.path), plan.outputFiles);
    assert.ok(textFiles.has("media/localized-media-map.json"));
    assert.ok([...textFiles.keys()].some(path => path.endsWith(".atlas")));
    assert.doesNotThrow(() => JSON.parse(textFiles.get("media/localized-media-map.json")));
});

test("publish fails closed when the native writer changes an output contract", async () => {
    const one = [source("single-common-001", "single")];
    const plan = createAuthoredImagePublishPlan(one, [{ mediaKey: "single", common: "single-common-001" }], { maxAtlasSize: 64, padding: 1 });
    await assert.rejects(
        () => publishAuthoredImages(plan, {
            async writeAtlasPage(page) {
                return { outputPath: `${page.outputPath}.other`, width: page.width, height: page.height, sha256: digest("d") };
            },
            async writeLooseImage() { throw new Error("unexpected"); },
            async writeTextFile() {},
        }),
        /changed the deterministic page contract/,
    );
});

test("writer cannot mutate page width, path, placements, or source identity", async () => {
    const one = [source("frozen-common-001", "frozen")];
    const plan = createAuthoredImagePublishPlan(one, [{ mediaKey: "frozen", common: "frozen-common-001" }], { maxAtlasSize: 64, padding: 1 });
    const before = JSON.stringify(plan);
    const mutations = [
        (page) => { page.width = 1; },
        (page) => { page.outputPath = "attacker/rewrote.png"; },
        (page) => { page.placements.push({ ...page.placements[0], uuid: "attacker-placement" }); },
        (_page, sources) => { sources[0].uuid = "attacker-source"; },
    ];
    for (const mutate of mutations) {
        await assert.rejects(
            () => publishAuthoredImages(plan, {
                async writeAtlasPage(page, sources) {
                    mutate(page, sources);
                    return { outputPath: page.outputPath, width: page.width, height: page.height, sha256: digest("e") };
                },
                async writeLooseImage() { throw new Error("unexpected"); },
                async writeTextFile() {},
            }),
            error => error instanceof TypeError || /mutated immutable page authority/.test(error.message),
        );
        assert.equal(JSON.stringify(plan), before);
    }
});

test("actual emitted atlas metadata round-trips through the real AtlasLoader", async t => {
    const emittedRoot = await mkdtemp(join(tmpdir(), "laya-authored-atlas-"));
    t.after(() => rm(emittedRoot, { recursive: true, force: true }));
    const packedSources = [
        source("roundtrip-common1", "roundtrip/one", { width: 12, height: 18 }),
        source("roundtrip-common2", "roundtrip/two", { width: 20, height: 10 }),
    ];
    const plan = createAuthoredImagePublishPlan(
        packedSources,
        packedSources.map(item => ({ mediaKey: item.mediaKey, common: item.uuid })),
        { maxAtlasSize: 64, padding: 1 },
    );
    await publishAuthoredImages(plan, {
        async writeAtlasPage(page) {
            const file = join(emittedRoot, ...page.outputPath.split("/"));
            await mkdir(dirname(file), { recursive: true });
            // Pixel encoding is the documented IDE HOLD. The real loader is
            // given a controlled native texture below; metadata is a real file.
            await writeFile(file, "IDE_NATIVE_ENCODER_HOLD");
            return { outputPath: page.outputPath, width: page.width, height: page.height, sha256: digest("f") };
        },
        async writeLooseImage() { throw new Error("unexpected"); },
        async writeTextFile(path, contents) {
            const file = join(emittedRoot, ...path.split("/"));
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, contents, "utf8");
        },
    });

    globalThis.document = globalThis.document || {};
    globalThis.window = globalThis.window || { document: globalThis.document };
    const { Loader } = await import("../../src/layaAir/laya/net/Loader.ts");
    await import("../../src/layaAir/laya/loaders/AtlasLoader.ts");
    const AtlasLoader = Loader.typeMap[Loader.ATLAS].loaderType;
    assert.equal(typeof AtlasLoader, "function");
    const cached = new Map();
    const manifestPath = plan.atlases[0].manifestPath;
    const bitmapByPage = new Map(plan.atlases[0].pages.map(page => [
        page.outputPath.substring(page.outputPath.lastIndexOf("/") + 1),
        {
            width: page.width,
            height: page.height,
            scaleRate: 1,
            _addReference() {},
            _removeReference() {},
        },
    ]));
    const task = {
        url: manifestPath,
        options: {},
        obsoluteInst: null,
        progress: { createCallback() { return () => {}; } },
        loader: {
            async fetch(url, type) {
                assert.equal(type, "json");
                return JSON.parse(await readFile(join(emittedRoot, ...url.split("/")), "utf8"));
            },
            async load(url) {
                const name = url.substring(url.lastIndexOf("/") + 1);
                assert.ok(bitmapByPage.has(name), `unexpected atlas page ${url}`);
                return bitmapByPage.get(name);
            },
            cacheRes(url, texture) { cached.set(url, texture); },
        },
    };
    const atlasResource = await new AtlasLoader().load(task);
    assert.ok(atlasResource);
    assert.equal(atlasResource.frames.length, packedSources.length);
    for (const item of packedSources) {
        const texture = cached.get(`res://${item.uuid}`);
        assert.ok(texture, `missing real AtlasLoader cache entry for ${item.uuid}`);
        assert.equal(texture.width, item.width);
        assert.equal(texture.height, item.height);
    }
});

test("post-pack preview uses standard atlas loading and verifies every res UUID", async () => {
    const plan = createAuthoredImagePublishPlan(inventory, localizedMedia, { maxAtlasSize: 64, padding: 1 });
    const loaded = [];
    const textures = new Map(plan.atlases.flatMap(atlas => atlas.pages.flatMap(page => page.placements))
        .map(item => [`res://${item.uuid}`, { width: item.width, height: item.height }]));
    const calls = [];
    const layaLoader = {
        async load(url, options) {
            calls.push([url, options]);
            loaded.push(url);
            return { url };
        },
        getRes(url) { return textures.get(url) || null; },
    };
    const result = await verifyAuthoredImageNativePreview(plan, createLayaAtlasPreviewLoader(layaLoader));
    assert.equal(result.atlasCount, plan.atlases.length);
    assert.equal(result.textureCount, textures.size);
    assert.ok(calls.every(([, options]) => options.type === "atlas" && options.cache === true));
    assert.deepEqual(loaded, plan.atlases.map(atlas => atlas.manifestPath));
});
