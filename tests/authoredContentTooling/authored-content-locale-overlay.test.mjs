import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = path.join(repositoryRoot, "build/npm-packages/laya-authored-content");
const api = await import(pathToFileURL(path.join(packageRoot, "dist/index.mjs")));

function textField(name, initialText) {
    return {
        linkage: name,
        instanceId: name,
        name,
        kind: "dynamic-text",
        textField: {
            sourceId: 1,
            type: "dynamic",
            multiline: false,
            wordWrap: false,
            selectable: false,
            displayAsPassword: false,
            autoSize: "none",
            html: false,
            filters: [],
            gutter: 2,
            overflow: "hidden",
            initialText,
            format: { fontMode: "device", font: "Arial", size: 12, color: 0, bold: false, italic: false, underline: false, align: "left", leftMargin: 0, rightMargin: 0, indent: 0, leading: 0, letterSpacing: 0, kerning: false }
        },
        children: []
    };
}

function imageResource(sha256, byteLength = 10) {
    return { id: "portrait", sourcePath: "portrait.png", mediaType: "image/png", byteLength, sha256, outputPath: "resources/portrait.png" };
}

function document({ label = "Ready", staticText = "Title", sha256 = "a".repeat(64), timeline = {} } = {}) {
    return {
        schema: "neutral-authored-content@1",
        documentId: "Lobby.Root",
        resources: [imageResource(sha256)],
        root: {
            linkage: "Lobby.Root",
            instanceId: "Lobby.Root",
            kind: "container",
            children: [
                { linkage: "caption", instanceId: "caption", name: "caption", kind: "text", text: staticText, children: [] },
                { linkage: "panel", instanceId: "panel", name: "panel", kind: "container", children: [textField("label", label)] },
                { linkage: "portraitNode", instanceId: "portraitNode", name: "portraitNode", kind: "image", resourceId: "portrait", children: [] }
            ]
        },
        timeline: { frameRate: 24, duration: 1, loop: false, frameLabels: {}, tracks: [], ...timeline }
    };
}

function request(base, localized, imageBindings) {
    return {
        id: "lobby-fr",
        locale: "fr_FR",
        baseCatalog: "Lobby.runtime-catalog.json",
        bundles: [{ bundle: "lobby", base, localized, ...(imageBindings ? { imageBindings } : {}) }]
    };
}

test("derives exact dynamic text and explicitly bound image deltas deterministically", () => {
    const base = Object.freeze(document());
    const localized = Object.freeze(document({ label: "Pret", sha256: "b".repeat(64), timeline: {} }));
    const overlay = api.deriveAuthoredContentLocaleOverlay(request(base, localized, [{
        resourceId: "portrait",
        assetId: "lobby/resources/portrait.png",
        path: "images/portrait.fr.png"
    }]));
    assert.deepEqual(overlay, {
        schema: "laya-authored-content-locale@1",
        id: "lobby-fr",
        locale: "fr_FR",
        baseCatalog: "Lobby.runtime-catalog.json",
        assetOverrides: [{ id: "lobby/resources/portrait.png", path: "images/portrait.fr.png" }],
        translations: [{ bundle: "lobby", target: "panel/label", text: "Pret" }]
    });
    assert.ok(Object.isFrozen(overlay));
    assert.equal(base.root.children[1].children[0].textField.initialText, "Ready", "base IR was mutated");
});

test("preserves exact authored text including whitespace and emits an empty overlay for equal evidence", () => {
    const changed = api.deriveAuthoredContentLocaleOverlay(request(document(), document({ label: "  Pret\n" })));
    assert.equal(changed.translations[0].text, "  Pret\n");
    const equal = api.deriveAuthoredContentLocaleOverlay(request(document(), structuredClone(document())));
    assert.deepEqual(equal.assetOverrides, []);
    assert.deepEqual(equal.translations, []);
});

test("fails closed for static text and structural timeline differences", () => {
    assert.throws(
        () => api.deriveAuthoredContentLocaleOverlay(request(document(), document({ staticText: "Titre" }))),
        error => error.code === "AUTHORED_CONTENT_LOCALE_STATIC_TEXT_DIFFERENCE"
    );
    assert.throws(
        () => api.deriveAuthoredContentLocaleOverlay(request(document(), document({ timeline: { duration: 2 } }))),
        error => error.code === "AUTHORED_CONTENT_LOCALE_STRUCTURAL_DIFFERENCE"
    );
});

test("never invents image deployment identity", () => {
    assert.throws(
        () => api.deriveAuthoredContentLocaleOverlay(request(document(), document({ sha256: "b".repeat(64) }))),
        error => error.code === "AUTHORED_CONTENT_LOCALE_IMAGE_BINDING_REQUIRED"
    );
    assert.throws(
        () => api.deriveAuthoredContentLocaleOverlay(request(document(), document(), [{ resourceId: "portrait", assetId: "invented", path: "portrait.png" }])),
        error => error.code === "AUTHORED_CONTENT_LOCALE_IMAGE_BINDING_UNUSED"
    );
});

test("text-map-only derives against exact base paths while ignoring localized non-text deltas", () => {
    const base = document();
    base.root.children[1].children[0].name = "character_82";
    base.root.children[1].children[0].instanceId = "character_82";
    base.root.children[1].children[0].linkage = "character_82";
    const localized = document({ label: "Pret", sha256: "b".repeat(64), timeline: { duration: 9 } });
    localized.documentId = "localized-document-id";
    localized.root.children[0].text = "Titre";
    localized.root.children[1].children[0].name = "character_81";
    localized.root.children[1].children[0].instanceId = "character_81";
    localized.root.children[1].children[0].linkage = "character_81";
    localized.root.children[1].children[0].textField.format.font = "Localized Font";
    const overlay = api.deriveAuthoredContentLocaleOverlay({
        ...request(base, localized),
        mode: "text-map-only"
    });
    assert.deepEqual(overlay.assetOverrides, []);
    assert.deepEqual(overlay.translations, [{ bundle: "lobby", target: "panel/character_82", text: "Pret" }]);
});

test("text-map-only fails closed on ambiguous, missing, or extra canonical text targets", () => {
    const base = document();
    base.root.children[1].children.push(textField("character_81", "Second"));
    base.root.children[1].children[0].name = "character_82";
    assert.throws(
        () => api.deriveAuthoredContentLocaleOverlay({ ...request(base, document()), mode: "text-map-only" }),
        error => error.code === "AUTHORED_CONTENT_LOCALE_TEXT_TARGET_AMBIGUOUS"
    );

    const localized = document();
    localized.root.children[1].children = [];
    assert.throws(
        () => api.deriveAuthoredContentLocaleOverlay({ ...request(document(), localized), mode: "text-map-only" }),
        error => error.code === "AUTHORED_CONTENT_LOCALE_TEXT_TARGET_SET_DIFFERENCE"
    );

    assert.throws(
        () => api.deriveAuthoredContentLocaleOverlay({
            ...request(document(), document(), [{ resourceId: "portrait", assetId: "portrait", path: "portrait.png" }]),
            mode: "text-map-only"
        }),
        error => error.code === "AUTHORED_CONTENT_LOCALE_MAP_ONLY_IMAGE_BINDINGS"
    );
});
