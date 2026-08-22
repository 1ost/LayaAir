import assert from "node:assert/strict";
import test from "node:test";

import { describeType } from "../../src/layaAir/flash/utils/describeType";
import {
    getDefinitionByName,
    registerDefinitionByName,
} from "../../src/layaAir/flash/utils/DefinitionRegistry";
import { getQualifiedClassName } from "../../src/layaAir/flash/utils/getQualifiedClassName";
import { getQualifiedSuperclassName } from "../../src/layaAir/flash/utils/getQualifiedSuperclassName";
import { isFlashQName, QName } from "../../src/layaAir/flash/utils/QName";

class AbstractModel {
    static readonly __className: string = "example.models.AbstractModel";

    baseField = "base";

    required(value: number): number {
        return value;
    }

    get readable(): number {
        return 1;
    }

    set writable(_value: number) {
    }
}

class ConcreteModel extends AbstractModel {
    static readonly __className: string = "example.models.ConcreteModel";

    ownField = 42;

    override required(value: number): number {
        return value + 1;
    }

    ownMethod(first: unknown, second: unknown): unknown[] {
        return [first, second];
    }

    get both(): string {
        return "value";
    }

    set both(_value: string) {
    }
}

test("QName preserves source-visible URI and local-name forms", () => {
    const empty = new QName();
    assert.equal(empty.uri, "");
    assert.equal(empty.localName, "");
    assert.equal(empty.toString(), "");

    const ordinary = new QName("urn:bleach", "member");
    assert.equal(ordinary.uri, "urn:bleach");
    assert.equal(ordinary.localName, "member");
    assert.equal(ordinary.toString(), "urn:bleach::member");

    assert.equal(new QName("", "member").toString(), "member");
    assert.equal(new QName(null, "member").toString(), "*::member");
});

test("QName copies nominal values and applies constructor string conversion", () => {
    const original = new QName("urn:original", "leaf");
    const copy = new QName(original);
    assert.notEqual(copy, original);
    assert.equal(copy.uri, original.uri);
    assert.equal(copy.localName, original.localName);

    assert.equal(new QName("single").toString(), "single");
    assert.equal(new QName(42, 7).toString(), "42::7");
    assert.equal(new QName("urn:other", original).localName, "leaf");
    assert.equal(original.valueOf(), original);
    assert.equal(isFlashQName(original), true);
    assert.equal(isFlashQName({ uri: "urn:original", localName: "leaf" }), false);
});

test("getQualifiedClassName covers primitives, classes, and registered native names", () => {
    assert.equal(getQualifiedClassName(null), "null");
    assert.equal(getQualifiedClassName(undefined), "void");
    assert.equal(getQualifiedClassName("text"), "String");
    assert.equal(getQualifiedClassName(false), "Boolean");
    assert.equal(getQualifiedClassName(1), "Number");
    assert.equal(getQualifiedClassName(ConcreteModel), "example.models::ConcreteModel");
    assert.equal(getQualifiedClassName(new ConcreteModel()), "example.models::ConcreteModel");
});

test("describeType reports effective native methods without duplicate base declarations", () => {
    const description = describeType(new ConcreteModel());
    assert.equal(description.name, "example.models::ConcreteModel");
    assert.equal(description.base, "example.models::AbstractModel");
    assert.equal(description.isStatic, false);

    const required = description.methods.filter(member => member.name === "required");
    assert.deepEqual(required, [{
        name: "required",
        declaredBy: "example.models::ConcreteModel",
        parameterCount: 1,
    }]);
    assert.deepEqual(
        description.methods.find(member => member.name === "ownMethod"),
        { name: "ownMethod", declaredBy: "example.models::ConcreteModel", parameterCount: 2 },
    );
});

test("describeType reports accessor capabilities and declared owners", () => {
    const description = describeType(new ConcreteModel());
    assert.deepEqual(
        description.accessors.find(member => member.name === "readable"),
        { name: "readable", declaredBy: "example.models::AbstractModel", access: "readonly" },
    );
    assert.deepEqual(
        description.accessors.find(member => member.name === "writable"),
        { name: "writable", declaredBy: "example.models::AbstractModel", access: "writeonly" },
    );
    assert.deepEqual(
        description.accessors.find(member => member.name === "both"),
        { name: "both", declaredBy: "example.models::ConcreteModel", access: "readwrite" },
    );
});

test("describeType reports instance variables without invoking accessors", () => {
    const description = describeType(new ConcreteModel());
    assert.deepEqual(description.variables, [
        { name: "baseField", declaredBy: "example.models::ConcreteModel", type: "String" },
        { name: "ownField", declaredBy: "example.models::ConcreteModel", type: "Number" },
    ]);
    assert.ok(Object.isFrozen(description));
    assert.ok(Object.isFrozen(description.methods));
});

test("class descriptions separate static and factory member surfaces", () => {
    const description = describeType(ConcreteModel);
    assert.equal(description.isStatic, true);
    assert.equal(description.base, "Class");
    assert.ok(description.factory);
    assert.equal(
        description.factory.methods.some(member => member.name === "ownMethod"),
        true,
    );
    assert.equal(description.factory.variables.length, 0);
});

test("superclass names round-trip through the finite observed definition registry", () => {
    assert.equal(
        getQualifiedSuperclassName(ConcreteModel),
        "example.models::AbstractModel",
    );
    assert.equal(
        getDefinitionByName("example.models.AbstractModel"),
        AbstractModel,
    );
    assert.equal(getQualifiedSuperclassName(AbstractModel), "Object");
    assert.equal(getDefinitionByName("Object"), Object);
    assert.equal(getQualifiedSuperclassName(Object), null);
});

test("explicit definition registration resolves finite names and rejects unknown names", () => {
    class RegisteredModel {
    }
    registerDefinitionByName("example.registered.Model", RegisteredModel);
    assert.equal(getDefinitionByName("example.registered::Model"), RegisteredModel);
    assert.throws(() => getDefinitionByName("example.missing::Model"), ReferenceError);
});
