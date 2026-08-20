import assert from "node:assert/strict";
import test from "node:test";
import {
    BlurFilter,
    ColorTransform,
    DisplayObject,
    Matrix,
    Point,
    Transform,
} from "../../src/layaAir/flash/index";
import { isFlashColorTransform } from "../../src/layaAir/flash/geom/ColorTransform";
import { isFlashMatrix } from "../../src/layaAir/flash/geom/Matrix";
import { isFlashTransform } from "../../src/layaAir/flash/geom/Transform";
import { Sprite as LayaSprite } from "../../src/layaAir/laya/display/Sprite";
import { Render2DProcessor } from "../../src/layaAir/laya/display/Render2DProcessor";
import { Matrix as LayaMatrix } from "../../src/layaAir/laya/maths/Matrix";
import { PostProcess2D } from "../../src/layaAir/laya/display/PostProcess2D";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { NoRenderUnitModuleDataFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderUnitModuleDataFactory";
import { ILaya } from "../../src/layaAir/ILaya";
import "../../src/layaAir/laya/ModuleDef";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
LayaGL.unitRenderModuleDataFactory = new NoRenderUnitModuleDataFactory();
await LayaGL.renderDeviceFactory.createEngine(null as any, null as any);
(Render2DProcessor as unknown as { runner: unknown }).runner = {};
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;

class GeometryDisplayObject extends DisplayObject {
    private readonly _geometryPostProcess = {
        clear(): void {},
        addEffect<T>(effect: T): T { return effect; },
    };
    protected override getPostProcess(_create = true): PostProcess2D {
        return this._geometryPostProcess as unknown as PostProcess2D;
    }
    override get postProcess(): PostProcess2D {
        return this._geometryPostProcess as unknown as PostProcess2D;
    }
    override set postProcess(_value: PostProcess2D) {}
}

function matrixValues(value: Matrix): number[] {
    return [value.a, value.b, value.c, value.d, value.tx, value.ty];
}

function colorValues(value: ColorTransform): number[] {
    return [value.redMultiplier, value.greenMultiplier, value.blueMultiplier, value.alphaMultiplier,
        value.redOffset, value.greenOffset, value.blueOffset, value.alphaOffset];
}

function approximately(actual: readonly number[], expected: readonly number[], epsilon = 1e-10): void {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon,
        `index ${index}: expected ${expected[index]}, received ${value}`));
}

test("Matrix preserves Flash composition, void mutations, points, boxes, and singular inversion", () => {
    const source = new Matrix(1, 2, 3, 4, 5, 6);
    assert.deepEqual(source.transformPoint(new Point(7, 8)), new Point(36, 52));
    assert.deepEqual(source.deltaTransformPoint(new Point(7, 8)), new Point(31, 46));
    assert.equal(source.toString(), "(a=1, b=2, c=3, d=4, tx=5, ty=6)");

    const copied = new Matrix();
    assert.equal(copied.copyFrom(source), undefined);
    assert.deepEqual(matrixValues(copied), matrixValues(source));
    assert.notEqual(copied, source);

    const concatenated = source.clone();
    assert.equal(concatenated.concat(new Matrix(7, 8, 9, 10, 11, 12)), undefined);
    assert.deepEqual(matrixValues(concatenated), [25, 28, 57, 64, 100, 112]);

    const inverse = source.clone();
    assert.equal(inverse.invert(), undefined);
    approximately(matrixValues(inverse), [-2, 1, 1.5, -0.5, 1, -2]);
    const singular = new Matrix(1, 2, 2, 4, 5, 6);
    singular.invert();
    assert.deepEqual(matrixValues(singular), [1, 0, 0, 1, 0, 0]);

    const box = new Matrix();
    assert.equal(box.createBox(2, 3, Math.PI / 2, 4, 5), undefined);
    approximately(matrixValues(box), [0, 3, -2, 0, 4, 5]);
    const gradient = new Matrix();
    assert.equal(gradient.createGradientBox(1638.4, 819.2, 0, 10, 20), undefined);
    approximately(matrixValues(gradient), [1, 0, 0, 0.5, 829.2, 429.6]);

    for (const result of [
        new Matrix().identity(), new Matrix().rotate(1), new Matrix().scale(2, 3),
        new Matrix().setTo(1, 2, 3, 4, 5, 6), new Matrix().translate(1, 2),
    ]) assert.equal(result, undefined);
});

test("ColorTransform preserves values, Flash concat direction, color, and detached clones", () => {
    const value = new ColorTransform(2, 3, 4, 5, 6, 7, 8, 9);
    assert.equal(value.color, 0x060708);
    assert.equal(value.concat(new ColorTransform(10, 20, 30, 40, 1, 2, 3, 4)), undefined);
    assert.deepEqual(colorValues(value), [20, 60, 120, 200, 8, 13, 20, 29]);

    const fractional = new ColorTransform(0.5, 0.5, 0.5, 0.5, 10.25, 20.25, 30.25, 40.25);
    fractional.concat(new ColorTransform(0.25, 0.25, 0.25, 0.25, 0.5, 2.5, -1.5, -3.5));
    assert.deepEqual(colorValues(fractional), [0.125, 0.125, 0.125, 0.125, 10.5, 21.5, 29.5, 38.5]);

    const color = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 7);
    color.color = 0x345678;
    assert.deepEqual(colorValues(color), [0, 0, 0, 0.5, 0x34, 0x56, 0x78, 7]);
    const clone = color.clone();
    clone.redOffset = 1;
    assert.equal(color.redOffset, 0x34);
});

test("DisplayObject Transform synchronizes the private native matrix, hierarchy, color, alpha, and filters", () => {
    const parent = new GeometryDisplayObject();
    const child = new GeometryDisplayObject();
    parent.addChild(child);

    parent.transform.matrix = new Matrix(2, 0, 0, 3, 10, 20);
    child.transform.matrix = new Matrix(1, 0, 0, 1, 4, 5);
    assert.equal(parent.transform instanceof LayaMatrix, false);
    assert.equal(parent.transform instanceof Matrix, false);
    assert.equal(parent.transform, parent.transform);
    assert.deepEqual(matrixValues(child.transform.concatenatedMatrix), [2, 0, 0, 3, 18, 35]);

    child.x = 9;
    child.scaleX = 4;
    approximately(matrixValues(child.transform.matrix), [4, 0, 0, 1, 9, 5]);
    const assigned = new GeometryDisplayObject();
    assigned.transform = child.transform;
    assert.deepEqual(matrixValues(assigned.transform.matrix), matrixValues(child.transform.matrix));

    const global = child.localToGlobal(new Point(1, 1));
    assert.deepEqual(global, new Point(36, 38));
    approximately([child.globalToLocal(global).x, child.globalToLocal(global).y], [1, 1]);

    parent.transform.colorTransform = new ColorTransform(0.5, 0.5, 0.5, 0.5, 10, 20, 30, 40);
    child.transform.colorTransform = new ColorTransform(0.25, 0.25, 0.25, 0.25, 1, 2, 3, 4);
    assert.deepEqual(colorValues(child.transform.concatenatedColorTransform),
        [0.125, 0.125, 0.125, 0.125, 10, 21, 31, 42]);
    assert.equal(child.alpha, 0.25);
    assert.deepEqual(child.filters, []);
    assert.ok(child.postProcess, "native color transform installs a Laya post-process");

    const blur = new BlurFilter(2, 3, 1);
    child.filters = [blur];
    assert.equal(child.filters.length, 1);
    assert.notEqual(child.filters[0], blur);
    child.alpha = 0.7;
    assert.equal(child.alpha, Math.trunc(0.7 * 256) / 256);
    assert.equal(child.transform.colorTransform.alphaMultiplier, child.alpha);

    child.transform.colorTransform = new ColorTransform();
    assert.equal(child.alpha, 1);
    assert.equal(child.filters.length, 1, "resetting color preserves user filters");
});

test("Matrix and Transform expose no Laya matrix surface", () => {
    const matrix = new Matrix();
    const transform = new DisplayObject().transform;
    const deniedMatrixMembers = ["_bTransform", "_checkTransform", "setTranslate", "skew", "invertTransformPoint",
        "transformPointN", "getScaleX", "getScaleY", "scaleEx", "rotateEx", "cloneTo", "copyTo", "setMatrix",
        "destroy", "recover"];
    const deniedMatrixStatics = ["EMPTY", "TEMP", "_createFun", "create", "equals", "extractTransformInfo", "mul", "mul16"];
    const deniedTransformMembers = ["a", "b", "c", "d", "tx", "ty", "clone", "concat", "copyFrom", "createBox",
        "createGradientBox", "deltaTransformPoint", "identity", "invert", "rotate", "scale", "setTo", "transformPoint",
        "translate", ...deniedMatrixMembers];
    for (const member of deniedMatrixMembers) assert.equal(member in matrix, false, member);
    for (const member of deniedMatrixStatics) assert.equal(member in Matrix, false, member);
    for (const member of deniedTransformMembers) assert.equal(member in transform, false, member);
    assert.equal(matrix instanceof LayaMatrix, false);
    assert.equal(transform instanceof LayaMatrix, false);
    assert.equal(transform instanceof Matrix, false);
});

test("geometry receivers reject detached, forged, and proxy calls before traps or arguments", () => {
    const matrix = new Matrix(1, 2, 3, 4, 5, 6);
    const color = new ColorTransform(1, 2, 3, 4, 5, 6, 7, 8);
    const transform = new DisplayObject().transform;
    let traps = 0;
    const hostile = new Proxy({}, {
        get() { traps++; throw new Error("hostile get"); },
        set() { traps++; throw new Error("hostile set"); },
        getPrototypeOf() { traps++; throw new Error("hostile prototype"); },
    });
    const matrixProxy = new Proxy(matrix, {
        get() { traps++; throw new Error("matrix get"); },
        set() { traps++; throw new Error("matrix set"); },
        getPrototypeOf() { traps++; throw new Error("matrix prototype"); },
    });
    const colorProxy = new Proxy(color, {
        get() { traps++; throw new Error("color get"); },
        set() { traps++; throw new Error("color set"); },
        getPrototypeOf() { traps++; throw new Error("color prototype"); },
    });
    const transformProxy = new Proxy(transform, {
        get() { traps++; throw new Error("transform get"); },
        set() { traps++; throw new Error("transform set"); },
        getPrototypeOf() { traps++; throw new Error("transform prototype"); },
    });
    assert.equal(isFlashMatrix(matrixProxy), false);
    assert.equal(isFlashColorTransform(colorProxy), false);
    assert.equal(isFlashTransform(transformProxy), false);
    assert.equal(traps, 0);

    const invalidMatrixReceivers = [{}, Object.create(Matrix.prototype), matrixProxy];
    const matrixMethods = ["clone", "concat", "copyFrom", "createBox", "createGradientBox", "deltaTransformPoint",
        "identity", "invert", "rotate", "scale", "setTo", "toString", "transformPoint", "translate"] as const;
    for (const receiver of invalidMatrixReceivers) for (const method of matrixMethods) {
        assert.throws(() => Reflect.apply(Matrix.prototype[method] as (...args: unknown[]) => unknown,
            receiver, [hostile, hostile, hostile, hostile, hostile, hostile]), /Invalid Matrix receiver/, `${method}`);
    }
    for (const property of ["a", "b", "c", "d", "tx", "ty"] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(Matrix.prototype, property)!;
        assert.throws(() => Reflect.apply(descriptor.get!, matrixProxy, []), /Invalid Matrix receiver/);
        assert.throws(() => Reflect.apply(descriptor.set!, matrixProxy, [hostile]), /Invalid Matrix receiver/);
    }

    const invalidColorReceivers = [{}, Object.create(ColorTransform.prototype), colorProxy];
    for (const receiver of invalidColorReceivers) {
        for (const method of ["clone", "concat", "toString"] as const)
            assert.throws(() => Reflect.apply(ColorTransform.prototype[method], receiver, [hostile]), /Invalid ColorTransform receiver/);
        for (const property of ["redMultiplier", "greenMultiplier", "blueMultiplier", "alphaMultiplier",
            "redOffset", "greenOffset", "blueOffset", "alphaOffset", "color"] as const) {
            const descriptor = Object.getOwnPropertyDescriptor(ColorTransform.prototype, property)!;
            assert.throws(() => Reflect.apply(descriptor.get!, receiver, []), /Invalid ColorTransform receiver/);
            assert.throws(() => Reflect.apply(descriptor.set!, receiver, [hostile]), /Invalid ColorTransform receiver/);
        }
    }

    const matrixBefore = matrixValues(matrix);
    assert.throws(() => matrix.concat(matrixProxy), /matrix must be a Matrix/);
    assert.throws(() => matrix.copyFrom(matrixProxy), /sourceMatrix must be a Matrix/);
    assert.deepEqual(matrixValues(matrix), matrixBefore);
    const colorBefore = colorValues(color);
    assert.throws(() => color.concat(colorProxy), /second must be a ColorTransform/);
    assert.deepEqual(colorValues(color), colorBefore);

    const transformMatrixSetter = Object.getOwnPropertyDescriptor(Transform.prototype, "matrix")!.set!;
    const transformColorSetter = Object.getOwnPropertyDescriptor(Transform.prototype, "colorTransform")!.set!;
    assert.throws(() => Reflect.apply(transformMatrixSetter, transformProxy, [hostile]), /Invalid Transform receiver/);
    assert.throws(() => Reflect.apply(transformColorSetter, transformProxy, [hostile]), /Invalid Transform receiver/);
    assert.throws(() => Reflect.apply(Transform.prototype.copyConcatenatedMatrixToOutput, transformProxy, [hostile]), /Invalid Transform receiver/);
    assert.throws(() => Reflect.apply(Transform.prototype.copyConcatenatedColorTransformToOutput, transformProxy, [hostile]), /Invalid Transform receiver/);
    const transformMatrixBefore = matrixValues(transform.matrix);
    const transformColorBefore = colorValues(transform.colorTransform);
    assert.throws(() => Reflect.apply(transformMatrixSetter, transform, [matrixProxy]), /matrix must be a Matrix/);
    assert.throws(() => Reflect.apply(transformColorSetter, transform, [colorProxy]), /colorTransform must be a ColorTransform/);
    assert.throws(() => transform.copyConcatenatedMatrixToOutput(matrixProxy), /output must be a Matrix/);
    assert.throws(() => transform.copyConcatenatedColorTransformToOutput(colorProxy), /output must be a ColorTransform/);
    assert.deepEqual(matrixValues(transform.matrix), transformMatrixBefore);
    assert.deepEqual(colorValues(transform.colorTransform), transformColorBefore);
    assert.equal(traps, 0);
});

test("geometry instances are sealed, prototypes frozen, and held surfaces stay absent", () => {
    const display = new DisplayObject();
    const matrix = new Matrix();
    const color = new ColorTransform();
    const transform = display.transform;
    for (const value of [matrix, color, transform]) assert.equal(Object.isSealed(value), true);
    for (const prototype of [Matrix.prototype, ColorTransform.prototype, Transform.prototype])
        assert.equal(Object.isFrozen(prototype), true);
    matrix.a = 2;
    color.alphaOffset = 3;
    assert.deepEqual([matrix.a, color.alphaOffset], [2, 3]);
    assert.equal(Reflect.defineProperty(matrix, "clone", { value: () => matrix }), false);
    assert.equal(Reflect.defineProperty(color, "concat", { value: (): void => {} }), false);
    assert.equal(Reflect.defineProperty(transform, "matrix", { value: matrix }), false);

    assert.equal(isFlashMatrix(matrix), true);
    assert.equal(isFlashColorTransform(color), true);
    assert.equal(isFlashTransform(transform), true);
    assert.equal(isFlashMatrix(Object.create(Matrix.prototype)), false);
    assert.equal(isFlashColorTransform(Object.create(ColorTransform.prototype)), false);
    assert.equal(isFlashTransform(Object.create(Transform.prototype)), false);
    assert.throws(() => new Transform(new LayaSprite() as unknown as DisplayObject), /DisplayObject/);
    assert.equal("matrix3D" in transform, false);
    assert.equal("perspectiveProjection" in transform, false);
    assert.equal("pixelBounds" in transform, false);
});
