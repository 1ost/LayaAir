import assert from "node:assert/strict";
import test from "node:test";

import { describeType } from "../../src/layaAir/flash/utils/describeType";
import { getQualifiedClassName } from "../../src/layaAir/flash/utils/getQualifiedClassName";

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
