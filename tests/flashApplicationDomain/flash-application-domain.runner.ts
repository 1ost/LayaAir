import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationDomain } from "../../src/layaAir/flash/system/ApplicationDomain";
import { registerDefinitionByName } from "../../src/layaAir/flash/utils/DefinitionRegistry";
import { MovieClip } from "../../src/layaAir/flash/display/MovieClip";
import { Sprite } from "../../src/layaAir/flash/display/Sprite";
import { TextField } from "../../src/layaAir/flash/text/TextField";
import { Node } from "../../src/layaAir/laya/display/Node";
import { ClassUtils } from "../../src/layaAir/laya/utils/ClassUtils";
import { Loader } from "../../src/layaAir/laya/net/Loader";
import { AssetDb } from "../../src/layaAir/laya/resource/AssetDb";
import { TextResource, TextResourceFormat } from "../../src/layaAir/laya/resource/TextResource";
import {
    activateAuthoredContentCatalog,
    authoredContentCatalogUrlForResource,
    loadAndActivateAuthoredContentCatalog,
    loadAndActivateAuthoredContentResource,
    type AuthoredContentCatalogManifest,
} from "../../src/extensions/authoredContent/runtime/AuthoredContentCatalog";
import {
    createAuthoredPrefabDefinition,
    registerAuthoredContentRuntime,
} from "../../src/extensions/authoredContent/runtime/bootstrap";

class RootAsset {
}

class ParentAsset {
}

class ChildAsset {
}

class PetHouseClip extends MovieClip {
}

class OtherPetHouseClip extends MovieClip {
}

class CatalogClip extends MovieClip {
    validated = false;
}

function createCatalogClip(): CatalogClip {
    const clip = Object.create(CatalogClip.prototype) as CatalogClip;
    clip.validated = false;
    Object.defineProperty(clip, "destroy", { value() {}, configurable: true });
    return clip;
}

test("currentDomain projects the native registry with Flash name aliases", () => {
    const current = ApplicationDomain.currentDomain;
    registerDefinitionByName("tests.application.RootAsset", RootAsset);

    assert.equal(ApplicationDomain.currentDomain, current);
    assert.equal(current.parentDomain, null);
    assert.equal(current.hasDefinition("tests.application::RootAsset"), true);
    assert.equal(current.getDefinition("tests.application.RootAsset"), RootAsset);
    assert.equal(current.getQualifiedDefinitionNames().includes("tests.application::RootAsset"), true);
});

test("child domains resolve local definitions before their parent", () => {
    const parent = new ApplicationDomain(ApplicationDomain.currentDomain);
    const child = new ApplicationDomain(parent);
    parent.registerDefinition("tests.application.Asset", ParentAsset);
    child.registerDefinition("tests.application::Asset", ChildAsset);

    assert.equal(parent.parentDomain, ApplicationDomain.currentDomain);
    assert.equal(child.parentDomain, parent);
    assert.equal(parent.getDefinition("tests.application::Asset"), ParentAsset);
    assert.equal(child.getDefinition("tests.application.Asset"), ChildAsset);
    assert.deepEqual(child.getQualifiedDefinitionNames(), ["tests.application::Asset"]);
});

test("child domains inherit root definitions and fail closed for missing names", () => {
    const child = new ApplicationDomain();

    assert.equal(child.getDefinition("tests.application.RootAsset"), RootAsset);
    assert.equal(child.hasDefinition("tests.application.Missing"), false);
    assert.equal(child.hasDefinition(null as unknown as string), false);
    assert.throws(() => child.getDefinition("tests.application.Missing"), ReferenceError);
    assert.throws(() => child.getDefinition(null as unknown as string), TypeError);
});

test("local registration is idempotent but rejects identity replacement", () => {
    const domain = new ApplicationDomain();
    domain.registerDefinition("tests.application.Asset", ParentAsset);
    domain.registerDefinition("tests.application::Asset", ParentAsset);

    assert.throws(
        () => domain.registerDefinition("tests.application.Asset", ChildAsset),
        /different identity/,
    );
    assert.throws(
        () => domain.registerDefinition("tests.application.Invalid", {} as never),
        TypeError,
    );
});

test("flat authored SymbolClass linkage registers and resolves through ApplicationDomain", () => {
    registerAuthoredContentRuntime([{
        id: "MC_PetHouse",
        ctor: PetHouseClip,
        sourceType: "MovieClip",
        serializedType: "Sprite",
    }]);
    assert.equal(ClassUtils.getClass("MC_PetHouse"), PetHouseClip);

    const prefab = { create: () => new PetHouseClip() };
    const Definition = createAuthoredPrefabDefinition("MC_PetHouse", prefab, PetHouseClip);
    ApplicationDomain.currentDomain.registerDefinition("MC_PetHouse", Definition);
    assert.equal(ApplicationDomain.currentDomain.hasDefinition("MC_PetHouse"), true);
    assert.equal(ApplicationDomain.currentDomain.getDefinition("MC_PetHouse"), Definition);
    assert.equal(Definition.prototype, PetHouseClip.prototype);

    assert.throws(() => registerAuthoredContentRuntime([{
        id: "MC_PetHouse",
        ctor: OtherPetHouseClip,
        sourceType: "MovieClip",
        serializedType: "Sprite",
    }]), /collision/);
    assert.throws(
        () => ApplicationDomain.currentDomain.registerDefinition("MC_PetHouse", OtherPetHouseClip),
        /different identity/,
    );
});

test("dotted authored linkage remains admitted while invalid and reserved IDs fail closed", () => {
    registerAuthoredContentRuntime([{
        id: "fixtures.PetHouse",
        ctor: PetHouseClip,
        sourceType: "MovieClip",
        serializedType: "Sprite",
    }]);
    assert.equal(ClassUtils.getClass("fixtures.PetHouse"), PetHouseClip);
    const prefab = { create: () => new PetHouseClip() };
    const DottedDefinition = createAuthoredPrefabDefinition("fixtures.PetHouse", prefab, PetHouseClip);
    const child = new ApplicationDomain();
    child.registerDefinition("fixtures.PetHouse", DottedDefinition);
    assert.equal(child.getDefinition("fixtures::PetHouse"), DottedDefinition);

    for (const id of [
        "", "9PetHouse", ".PetHouse", "PetHouse.", "Pet..House", "Pet-House",
        "flash", "flash.display.MovieClip", "laya", "laya.display.Sprite",
    ]) {
        assert.throws(
            () => createAuthoredPrefabDefinition(id, prefab, PetHouseClip),
            /application-owned/,
        );
        assert.throws(() => registerAuthoredContentRuntime([{
            id,
            ctor: OtherPetHouseClip,
            sourceType: "MovieClip",
            serializedType: "Sprite",
        }]), /application-owned/);
    }
});

test("authored catalogs own asset loading and ApplicationDomain publication", async () => {
    const domain = new ApplicationDomain();
    const calls: Array<[string, string | undefined]> = [];
    const prefab = { create: () => createCatalogClip() };
    const loader = {
        async load(url: string, type?: string): Promise<unknown> {
            calls.push([url, type]);
            if (type === Loader.IMAGE) return { url };
            if (type === Loader.HIERARCHY) return prefab;
            return { url };
        },
    };
    const manifest: AuthoredContentCatalogManifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.catalog",
        bundles: [{
            id: "pet-house",
            runtimeId: "fixtures.catalog.PetHouse",
            linkage: "MC_CatalogPetHouse",
            sourceType: "MovieClip",
            prefab: "native/pet-house.lh",
            assets: [
                { id: "catalog/images/root", path: "native/images/root.png", kind: "image" },
                { id: "catalog/fonts/root", path: "native/fonts/root.ttf", kind: "font" },
                { id: "catalog/timelines/root", path: "native/root.mc", kind: "timeline" },
            ],
        }],
    };
    let validationCount = 0;
    const catalogBinding = {
        runtimeId: "fixtures.catalog.PetHouse",
        ctor: CatalogClip,
        validate(root: CatalogClip) {
            validationCount += 1;
            root.validated = true;
        },
    } as const;
    const first = await activateAuthoredContentCatalog(manifest, {
        baseUrl: "/fixtures/catalog/",
        loader,
        applicationDomain: domain,
        runtimeBindings: [catalogBinding],
    });

    assert.deepEqual(calls, [
        ["/fixtures/catalog/native/images/root.png", Loader.IMAGE],
        ["/fixtures/catalog/native/fonts/root.ttf", Loader.BUFFER],
        ["/fixtures/catalog/native/root.mc", undefined],
        ["/fixtures/catalog/native/pet-house.lh", Loader.HIERARCHY],
    ]);
    assert.equal(AssetDb.inst.uuidMap["catalog/images/root"], "/fixtures/catalog/native/images/root.png");
    assert.equal(AssetDb.inst.uuidMap["catalog/fonts/root"], "/fixtures/catalog/native/fonts/root.ttf");
    assert.equal(AssetDb.inst.uuidMap["catalog/timelines/root"], "/fixtures/catalog/native/root.mc");
    assert.equal(validationCount, 1);
    assert.equal(domain.hasDefinition("MC_CatalogPetHouse"), true);
    const reflected = new (domain.getDefinition("MC_CatalogPetHouse") as new () => CatalogClip)();
    assert.ok(reflected instanceof CatalogClip);
    reflected.destroy(true);
    const created = first.create("pet-house");
    assert.ok(created instanceof CatalogClip);
    created.destroy(true);
    assert.equal(first.prefabFor("pet-house"), prefab);

    const second = await activateAuthoredContentCatalog(manifest, {
        baseUrl: "/fixtures/catalog/",
        loader,
        applicationDomain: domain,
        runtimeBindings: [catalogBinding],
    });
    assert.equal(second, first);
    assert.equal(calls.length, 4);
});

test("authored catalogs activate embedded-font startup before loading or constructing prefabs", async () => {
    const domain = new ApplicationDomain();
    const calls: Array<[string, string | undefined]> = [];
    const manifest: AuthoredContentCatalogManifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.font-startup-order",
        bundles: [{
            id: "font-entry",
            runtimeId: "fixtures.catalog.FontStartupOrder",
            linkage: "MC_FontStartupOrder",
            sourceType: "MovieClip",
            prefab: "native/font-entry.lh",
            fontStartup: "native/font-entry.font-startup.json",
            assets: [],
        }],
    };
    const invalidStartup = new TextEncoder().encode("{}\n").buffer;
    await assert.rejects(activateAuthoredContentCatalog(manifest, {
        baseUrl: "/fixtures/catalog/",
        applicationDomain: domain,
        loader: {
            async load(url: string, type?: string): Promise<unknown> {
                calls.push([url, type]);
                if (url.endsWith(".font-startup.json") && type === Loader.BUFFER)
                    return invalidStartup;
                throw new Error(`prefab loaded before font startup: ${url}`);
            },
        },
    }), /startup must contain exactly/);
    assert.deepEqual(calls, [[
        "/fixtures/catalog/native/font-entry.font-startup.json",
        Loader.BUFFER,
    ]]);
    assert.equal(domain.hasDefinition("MC_FontStartupOrder"), false);
});

test("authored catalogs reject data drift, path escape and asset collisions", async () => {
    const domain = new ApplicationDomain();
    const loader = { load: async () => ({ create: () => createCatalogClip() }) };
    const manifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.fail-closed",
        bundles: [{
            id: "entry",
            runtimeId: "fixtures.catalog.FailClosed",
            linkage: "MC_CatalogFailClosed",
            sourceType: "MovieClip",
            prefab: "native/entry.lh",
            assets: [],
        }],
    } as const;
    await activateAuthoredContentCatalog(manifest, {
        baseUrl: "/fixtures/fail-closed/",
        loader,
        applicationDomain: domain,
        runtimeBindings: [{ runtimeId: "fixtures.catalog.FailClosed", ctor: CatalogClip }],
    });
    assert.throws(() => activateAuthoredContentCatalog({
        ...manifest,
        bundles: [{ ...manifest.bundles[0], prefab: "native/replacement.lh" }],
    }, {
        baseUrl: "/fixtures/fail-closed/",
        loader,
        applicationDomain: domain,
    }), /changed after activation/);
    assert.throws(() => activateAuthoredContentCatalog({
        ...manifest,
        id: "fixtures.path-escape",
        bundles: [{ ...manifest.bundles[0], runtimeId: "fixtures.catalog.PathEscape", linkage: "MC_PathEscape", prefab: "../escape.lh" }],
    }, {
        baseUrl: "/fixtures/path-escape/",
        loader,
        applicationDomain: new ApplicationDomain(),
    }), /normalized relative asset path/);
    assert.throws(() => activateAuthoredContentCatalog({
        ...manifest,
        id: "fixtures.asset-kind",
        bundles: [{
            ...manifest.bundles[0],
            runtimeId: "fixtures.catalog.AssetKind",
            linkage: "MC_AssetKind",
            assets: [{ id: "fixtures/asset-kind", path: "native/entry.bin", kind: "binary" }],
        }],
    } as never, {
        baseUrl: "/fixtures/asset-kind/",
        loader,
        applicationDomain: new ApplicationDomain(),
    }), /kind must be font, image or timeline/);
});

test("authored catalog URL loading derives one manifest-relative asset root", async () => {
    const manifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.loaded-catalog",
        bundles: [{
            id: "entry",
            runtimeId: "fixtures.catalog.Loaded",
            linkage: "MC_LoadedCatalog",
            sourceType: "MovieClip",
            prefab: "native/entry.lh",
            assets: [],
        }],
    } as const;
    const prefab = { create: () => createCatalogClip() };
    const calls: Array<[string, string | undefined]> = [];
    const loader = {
        async load(url: string, type?: string): Promise<unknown> {
            calls.push([url, type]);
            return type === Loader.JSON
                ? new TextResource(manifest, TextResourceFormat.JSON)
                : prefab;
        },
    };
    const activation = await loadAndActivateAuthoredContentCatalog(
        "/fixtures/loaded/runtime-catalog.json",
        {
            loader,
            applicationDomain: new ApplicationDomain(),
            runtimeBindings: [{ runtimeId: "fixtures.catalog.Loaded", ctor: CatalogClip }],
        },
    );
    assert.ok(activation.create("entry") instanceof CatalogClip);
    assert.deepEqual(calls, [
        ["/fixtures/loaded/runtime-catalog.json", Loader.JSON],
        ["/fixtures/loaded/native/entry.lh", Loader.HIERARCHY],
    ]);
});

test("logical SWF resources resolve localized requests to adjacent maps beside the en_Eu native catalog", async () => {
    assert.equal(
        authoredContentCatalogUrlForResource("Resources/en_Eu/Swf/Lobby/GirlGame.swf"),
        "Resources/en_Eu/Swf/Lobby/GirlGame.runtime-catalog.json",
    );
    assert.equal(
        authoredContentCatalogUrlForResource("https://cdn.invalid/Resources/de_DE/Swf/Common/Common.SWF?v=4#entry"),
        "https://cdn.invalid/Resources/en_Eu/Swf/Common/Common.de_DE.locale.json?v=4#entry",
    );
    assert.throws(() => authoredContentCatalogUrlForResource("Resources/en_Eu/Textures/Lobby/1.png"), /\.swf/);

    const manifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.resource-sidecar",
        bundles: [{
            id: "entry",
            runtimeId: "fixtures.catalog.ResourceSidecar",
            linkage: "MC_ResourceSidecar",
            sourceType: "MovieClip",
            prefab: "GirlGame.native/entry.lh",
            assets: [],
        }],
    } as const;
    const overlay = {
        schema: "laya-authored-content-locale@1",
        id: "fixtures.resource-sidecar-fr",
        locale: "fr_FR",
        baseCatalog: "GirlGame.runtime-catalog.json",
        assetOverrides: [],
        translations: [],
    } as const;
    const calls: Array<[string, string | undefined]> = [];
    const activation = await loadAndActivateAuthoredContentResource(
        "Resources/fr_FR/Swf/Lobby/GirlGame.swf?release=7",
        {
            loader: {
                async load(url: string, type?: string): Promise<unknown> {
                    calls.push([url, type]);
                    if (url.endsWith("GirlGame.fr_FR.locale.json?release=7")) return overlay;
                    return type === Loader.JSON ? manifest : { create: () => createCatalogClip() };
                },
            },
            applicationDomain: new ApplicationDomain(),
            runtimeBindings: [{ runtimeId: "fixtures.catalog.ResourceSidecar", ctor: CatalogClip }],
        },
    );
    assert.ok(activation.create("entry") instanceof CatalogClip);
    assert.deepEqual(calls, [
        ["Resources/en_Eu/Swf/Lobby/GirlGame.fr_FR.locale.json?release=7", Loader.JSON],
        ["Resources/en_Eu/Swf/Lobby/GirlGame.runtime-catalog.json", Loader.JSON],
        ["Resources/en_Eu/Swf/Lobby/GirlGame.native/entry.lh", Loader.HIERARCHY],
    ]);
});

test("locale overlays share native structure while replacing editable text and baked-text images", async () => {
    const domain = new ApplicationDomain();
    const title = Object.create(TextField.prototype) as TextField;
    Object.defineProperty(title, "text", { value: "English", writable: true, configurable: true });
    const prefab = {
        create: () => {
            const root = createCatalogClip();
            Object.defineProperty(root, "getChildByName", {
                value: (name: string) => name === "TF_Title" ? title : null,
                configurable: true,
            });
            return root;
        },
    };
    const base = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.localized-base",
        bundles: [{
            id: "entry",
            runtimeId: "fixtures.catalog.Localized",
            linkage: "MC_LocalizedCatalog",
            sourceType: "MovieClip",
            prefab: "Foo.native/entry.lh",
            assets: [
                { id: "localized/images/title", path: "Foo.native/title-en.png", kind: "image" },
                { id: "localized/timelines/root", path: "Foo.native/root.mc", kind: "timeline" },
            ],
        }],
    } as const;
    const overlay = {
        schema: "laya-authored-content-locale@1",
        id: "fixtures.localized-de",
        locale: "de_DE",
        baseCatalog: "Foo.runtime-catalog.json",
        assetOverrides: [{ id: "localized/images/title", path: "Foo.locale/title-de.png" }],
        translations: [{ bundle: "entry", target: "TF_Title", text: "Deutsch" }],
    } as const;
    const calls: Array<[string, string | undefined]> = [];
    const loader = {
        async load(url: string, type?: string): Promise<unknown> {
            calls.push([url, type]);
            if (url.endsWith("Foo.de_DE.locale.json") && type === Loader.JSON) return overlay;
            if (url === "/Resources/en_Eu/Swf/Lobby/Foo.runtime-catalog.json" && type === Loader.JSON) return base;
            if (type === Loader.HIERARCHY) return prefab;
            return { url };
        },
    };
    const activation = await loadAndActivateAuthoredContentResource(
        "/Resources/de_DE/Swf/Lobby/Foo.swf",
        {
            loader,
            applicationDomain: domain,
            runtimeBindings: [{ runtimeId: "fixtures.catalog.Localized", ctor: CatalogClip }],
        },
    );

    assert.deepEqual(calls, [
        ["/Resources/en_Eu/Swf/Lobby/Foo.de_DE.locale.json", Loader.JSON],
        ["/Resources/en_Eu/Swf/Lobby/Foo.runtime-catalog.json", Loader.JSON],
        ["/Resources/en_Eu/Swf/Lobby/Foo.locale/title-de.png", Loader.IMAGE],
        ["/Resources/en_Eu/Swf/Lobby/Foo.native/root.mc", undefined],
        ["/Resources/en_Eu/Swf/Lobby/Foo.native/entry.lh", Loader.HIERARCHY],
    ]);
    assert.equal(
        AssetDb.inst.uuidMap["localized/images/title"],
        "/Resources/en_Eu/Swf/Lobby/Foo.locale/title-de.png",
    );
    assert.equal(
        AssetDb.inst.uuidMap["localized/timelines/root"],
        "/Resources/en_Eu/Swf/Lobby/Foo.native/root.mc",
    );
    const reflected = new (domain.getDefinition("MC_LocalizedCatalog") as new () => CatalogClip)();
    assert.equal(title.text, "Deutsch");
    assert.ok(reflected instanceof CatalogClip);
    reflected.destroy(true);
    const created = activation.create("entry");
    assert.equal(title.text, "Deutsch");
    created.destroy(true);
});

test("locale overlays resolve duplicate authored names through unique dynamic-text source identities", async () => {
    const fields = [288, 296].map(sourceId => {
        const field = Object.create(TextField.prototype) as TextField & { authoredConfiguration: { sourceId: number } };
        Object.defineProperties(field, {
            name: { value: "AttributeName", writable: true, configurable: true },
            text: { value: "Post-inherit", writable: true, configurable: true },
            destroyed: { value: false, configurable: true },
            authoredConfiguration: { value: { sourceId }, configurable: true },
        });
        return field;
    });
    const prefab = {
        create: () => {
            const panel = Object.create(Node.prototype) as Node;
            Object.defineProperties(panel, {
                numChildren: { value: fields.length, configurable: true },
                getChildByName: { value: (): null => null, configurable: true },
                getChildAt: { value: (index: number) => fields[index], configurable: true },
            });
            const root = createCatalogClip();
            Object.defineProperty(root, "getChildByName", {
                value: (name: string) => name === "UIInherit" ? panel : null,
                configurable: true,
            });
            return root;
        },
    };
    const manifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.duplicate-text-base",
        bundles: [{
            id: "entry", runtimeId: "fixtures.catalog.DuplicateText", linkage: "MC_DuplicateText",
            sourceType: "MovieClip", prefab: "entry.lh", assets: [],
        }],
    } as const;
    const overlay = {
        schema: "laya-authored-content-locale@1",
        id: "fixtures.duplicate-text-de", locale: "de_DE", baseCatalog: "Duplicate.runtime-catalog.json",
        assetOverrides: [], translations: [
            { bundle: "entry", target: "UIInherit/character_288$d21$f1$i9", text: "Nach Vererbung A" },
            { bundle: "entry", target: "UIInherit/character_296$d30$f1$i17", text: "Nach Vererbung B" },
        ],
    } as const;
    const activation = await loadAndActivateAuthoredContentResource("/Resources/de_DE/Swf/Duplicate.swf", {
        loader: { async load(_url: string, type?: string): Promise<unknown> {
            if (type === Loader.JSON) return _url.endsWith(".locale.json") ? overlay : manifest;
            return prefab;
        } },
        applicationDomain: new ApplicationDomain(),
        runtimeBindings: [{ runtimeId: "fixtures.catalog.DuplicateText", ctor: CatalogClip }],
    });
    activation.create("entry");
    assert.deepEqual(fields.map(field => field.text), ["Nach Vererbung A", "Nach Vererbung B"]);

    fields[1].authoredConfiguration.sourceId = 288;
    assert.throws(() => activation.create("entry"), /ambiguous generated placement identity/);
});

test("locale overlays fail closed on timeline replacement and unknown text targets", async () => {
    const base = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.localized-reject",
        bundles: [{
            id: "entry",
            runtimeId: "fixtures.catalog.LocalizedReject",
            linkage: "MC_LocalizedReject",
            sourceType: "MovieClip",
            prefab: "entry.lh",
            assets: [{ id: "localized/reject/root", path: "root.mc", kind: "timeline" }],
        }],
    } as const;
    const load = async (overlay: object, domain: ApplicationDomain): Promise<void> => {
        const loader = {
            async load(url: string, type?: string): Promise<unknown> {
                if (url.endsWith(".de_DE.locale.json") && type === Loader.JSON) return overlay;
                if (type === Loader.JSON) return base;
                return { create: () => {
                    const root = createCatalogClip();
                    Object.defineProperty(root, "getChildByName", {
                        value: (): null => null,
                        configurable: true,
                    });
                    return root;
                } };
            },
        };
        await loadAndActivateAuthoredContentResource("/Resources/de_DE/Swf/Reject.swf", {
            loader,
            applicationDomain: domain,
            runtimeBindings: [{ runtimeId: "fixtures.catalog.LocalizedReject", ctor: CatalogClip }],
        });
    };
    await assert.rejects(load({
        schema: "laya-authored-content-locale@1",
        id: "fixtures.timeline-reject",
        locale: "de_DE",
        baseCatalog: "Reject.runtime-catalog.json",
        assetOverrides: [{ id: "localized/reject/root", path: "root-de.mc" }],
        translations: [],
    }, new ApplicationDomain()), /structural timelines require a full catalog/);
    const unknownTargetDomain = new ApplicationDomain();
    await assert.rejects(load({
        schema: "laya-authored-content-locale@1",
        id: "fixtures-target-reject",
        locale: "de_DE",
        baseCatalog: "Reject.runtime-catalog.json",
        assetOverrides: [],
        translations: [{ bundle: "entry", target: "TF_Missing", text: "Fehlt" }],
    }, unknownTargetDomain), /text target 'TF_Missing' is missing/);
    assert.equal(unknownTargetDomain.hasDefinition("MC_LocalizedReject"), false);
});

test("generic catalogs can publish inherited Sprite and MovieClip source constructors", async () => {
    const domain = new ApplicationDomain();
    const manifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.inherited-source-types",
        bundles: [
            {
                id: "sprite",
                runtimeId: "fixtures.catalog.InheritedSprite",
                linkage: "MC_InheritedSprite",
                sourceType: "Sprite",
                prefab: "sprite.lh",
                assets: [],
            },
            {
                id: "movie-clip",
                runtimeId: "fixtures.catalog.InheritedMovieClip",
                linkage: "MC_InheritedMovieClip",
                sourceType: "MovieClip",
                prefab: "movie-clip.lh",
                assets: [],
            },
        ],
    } as const;
    const activation = await activateAuthoredContentCatalog(manifest, {
        applicationDomain: domain,
        baseUrl: "/fixtures/",
        loader: {
            async load(): Promise<unknown> {
                return { create: () => createCatalogClip() };
            },
        },
    });
    assert.ok(activation.create("sprite") instanceof Sprite);
    assert.ok(activation.create("movie-clip") instanceof MovieClip);
    assert.equal(domain.hasDefinition("MC_InheritedSprite"), true);
    assert.equal(domain.hasDefinition("MC_InheritedMovieClip"), true);
});

test("authored catalogs use the declared Flash base type when no behavior binding exists", async () => {
    const domain = new ApplicationDomain();
    const manifest = {
        schema: "laya-authored-content-catalog@1",
        id: "fixtures.base-type-catalog",
        bundles: [{
            id: "entry",
            runtimeId: "fixtures.catalog.BaseMovieClip",
            linkage: "MC_BaseMovieClip",
            sourceType: "MovieClip",
            prefab: "native/entry.lh",
            assets: [],
        }],
    } as const;
    const prefab = {
        create: () => {
            const clip = Object.create(MovieClip.prototype) as MovieClip;
            Object.defineProperty(clip, "destroy", { value() {}, configurable: true });
            return clip;
        },
    };
    const activation = await activateAuthoredContentCatalog(manifest, {
        baseUrl: "/fixtures/base-type/",
        loader: { load: async () => prefab },
        applicationDomain: domain,
    });
    const reflected = new (domain.getDefinition("MC_BaseMovieClip") as new () => MovieClip)();
    assert.ok(reflected instanceof MovieClip);
    reflected.destroy(true);
    const created = activation.create("entry");
    assert.ok(created instanceof MovieClip);
    created.destroy(true);
});
