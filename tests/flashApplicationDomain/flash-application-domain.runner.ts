import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationDomain } from "../../src/layaAir/flash/system/ApplicationDomain";
import { registerDefinitionByName } from "../../src/layaAir/flash/utils/DefinitionRegistry";

class RootAsset {
}

class ParentAsset {
}

class ChildAsset {
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
