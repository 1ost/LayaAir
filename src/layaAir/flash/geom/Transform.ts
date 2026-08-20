import type { DisplayObject } from "../display/DisplayObject";
import { isFlashDisplayObject } from "../display/DisplayObject";
import { ColorMatrixFilter } from "../filters/ColorMatrixFilter";
import { BitmapFilter } from "../filters/BitmapFilter";
import { isBitmapFilter } from "../filters/FilterRegistry";
import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { Matrix as LayaMatrix } from "../../laya/maths/Matrix";
import { ColorTransform, isFlashColorTransform } from "./ColorTransform";
import { isFlashMatrix, Matrix } from "./Matrix";

const TRANSFORM_VALUES = new WeakMap<object, DisplayObject>();
const DISPLAY_TRANSFORMS = new WeakMap<object, Transform>();
const DISPLAY_COLORS = new WeakMap<object, ColorTransform>();
const DISPLAY_COLOR_FILTERS = new WeakMap<object, ColorMatrixFilter>();

const NATIVE_FILTERS = Object.getOwnPropertyDescriptor(LayaSprite.prototype, "filters");
if (!NATIVE_FILTERS?.get || !NATIVE_FILTERS.set)
    throw new Error("Laya Sprite filter accessors are unavailable");

interface NativeTransformHost {
    _getNativeTransform(): LayaMatrix | null;
    _setNativeTransform(value: LayaMatrix): void;
}

/** @internal Nominal proof for authenticated runtime `is` checks. */
export function isFlashTransform(value: unknown): value is Transform {
    return typeof value === "object" && value !== null && TRANSFORM_VALUES.has(value);
}

function targetFor(value: Transform): DisplayObject {
    const target = TRANSFORM_VALUES.get(value);
    if (!target) throw new TypeError("Invalid Transform receiver");
    return target;
}

function nativeHost(target: DisplayObject): NativeTransformHost {
    return target as unknown as NativeTransformHost;
}

function nativeMatrix(target: DisplayObject): LayaMatrix | null {
    return nativeHost(target)._getNativeTransform();
}

function setNativeMatrix(target: DisplayObject, value: LayaMatrix): void {
    nativeHost(target)._setNativeTransform(value);
}

function nativeFilters(target: DisplayObject): BitmapFilter[] {
    return (NATIVE_FILTERS.get!.call(target) as BitmapFilter[] | null) ?? [];
}

function setNativeFilters(target: DisplayObject, value: BitmapFilter[] | null): void {
    NATIVE_FILTERS.set!.call(target, value);
}

function localMatrix(target: DisplayObject): Matrix {
    const value = nativeMatrix(target);
    if (!value) return new Matrix(1, 0, 0, 1, target.x, target.y);
    return new Matrix(value.a, value.b, value.c, value.d, target.x, target.y);
}

function quantizedDisplayColor(value: ColorTransform): ColorTransform {
    return new ColorTransform(
        Math.trunc(value.redMultiplier * 256) / 256,
        Math.trunc(value.greenMultiplier * 256) / 256,
        Math.trunc(value.blueMultiplier * 256) / 256,
        Math.trunc(value.alphaMultiplier * 256) / 256,
        Math.trunc(value.redOffset),
        Math.trunc(value.greenOffset),
        Math.trunc(value.blueOffset),
        Math.trunc(value.alphaOffset),
    );
}

/** Native owner alpha owns the multiplier; the internal matrix owns only the offset. */
function colorMatrix(value: ColorTransform): number[] {
    return [
        value.redMultiplier, 0, 0, 0, value.redOffset,
        0, value.greenMultiplier, 0, 0, value.greenOffset,
        0, 0, value.blueMultiplier, 0, value.blueOffset,
        0, 0, 0, 1, value.alphaOffset,
    ];
}

function requiresNativeColorFilter(value: ColorTransform): boolean {
    return value.redMultiplier !== 1 || value.greenMultiplier !== 1 || value.blueMultiplier !== 1
        || value.redOffset !== 0 || value.greenOffset !== 0 || value.blueOffset !== 0
        || value.alphaOffset !== 0;
}

function installColorTransform(target: DisplayObject, value: ColorTransform): void {
    const previous = DISPLAY_COLOR_FILTERS.get(target);
    const filters = previous
        ? nativeFilters(target).filter(filter => filter !== previous)
        : Array.from(nativeFilters(target));
    if (requiresNativeColorFilter(value)) {
        const filter = new ColorMatrixFilter(colorMatrix(value));
        filters.unshift(filter);
        DISPLAY_COLOR_FILTERS.set(target, filter);
    } else {
        DISPLAY_COLOR_FILTERS.delete(target);
    }
    setNativeFilters(target, filters.length ? filters : null);
}

function synchronizedColor(target: DisplayObject): ColorTransform {
    const alpha = Math.trunc(Math.max(0, Math.min(1, Number(target.alpha))) * 256) / 256;
    const stored = DISPLAY_COLORS.get(target);
    if (stored && stored.alphaMultiplier !== alpha) {
        const synchronized = stored.clone();
        synchronized.alphaMultiplier = alpha;
        DISPLAY_COLORS.set(target, synchronized);
        installColorTransform(target, synchronized);
    }
    const result = (DISPLAY_COLORS.get(target) ?? new ColorTransform()).clone();
    result.alphaMultiplier = alpha;
    return result;
}

/** @internal Keeps direct DisplayObject.alpha assignments in Flash color state. */
export function synchronizeDisplayObjectAlpha(target: DisplayObject): void {
    if (!isFlashDisplayObject(target)) throw new TypeError("target must be a DisplayObject");
    synchronizedColor(target);
}

/** @internal Returns the cached Flash facade while retaining native matrix state privately. */
export function transformForDisplayObject(target: DisplayObject): Transform {
    if (!isFlashDisplayObject(target)) throw new TypeError("target must be a DisplayObject");
    let value = DISPLAY_TRANSFORMS.get(target);
    if (!value) {
        value = new Transform(target);
        DISPLAY_TRANSFORMS.set(target, value);
    }
    return value;
}

/** @internal Applies an assigned Flash Transform to the native Laya display state. */
export function applyTransformToDisplayObject(target: DisplayObject, value: Transform): void {
    if (!isFlashDisplayObject(target)) throw new TypeError("target must be a DisplayObject");
    if (!isFlashTransform(value)) throw new TypeError("transform must be a Transform");
    const sourceTarget = targetFor(value);
    const destination = transformForDisplayObject(target);
    destination.matrix = localMatrix(sourceTarget);
    destination.colorTransform = synchronizedColor(sourceTarget);
}

/** @internal Detached Flash filter reads hide the color-transform implementation filter. */
export function getDisplayObjectFilters(target: DisplayObject): BitmapFilter[] {
    if (!isFlashDisplayObject(target)) throw new TypeError("target must be a DisplayObject");
    const internal = DISPLAY_COLOR_FILTERS.get(target);
    const detached: BitmapFilter[] = [];
    for (const value of nativeFilters(target)) {
        if (internal && value === internal) continue;
        if (!isBitmapFilter(value)) throw new TypeError("Flash DisplayObject contains a non-Flash filter");
        detached.push(value.clone());
    }
    return detached;
}

/** @internal Replaces user filters without disturbing the native color transform. */
export function setDisplayObjectFilters(target: DisplayObject, value: BitmapFilter[] | null): void {
    if (!isFlashDisplayObject(target)) throw new TypeError("target must be a DisplayObject");
    const detached: BitmapFilter[] = [];
    if (value != null) {
        if (!Array.isArray(value)) throw new TypeError("DisplayObject.filters must be an Array");
        for (let index = 0; index < value.length; index++) {
            const filter = value[index];
            if (!isBitmapFilter(filter))
                throw new TypeError(`DisplayObject.filters[${index}] must be a concrete native BitmapFilter`);
            detached.push(filter.clone());
        }
    }
    const internal = DISPLAY_COLOR_FILTERS.get(target);
    if (internal) detached.unshift(internal);
    setNativeFilters(target, detached.length ? detached : null);
}

/** Flash transform facade synchronized with one native Laya DisplayObject. */
export class Transform {
    constructor(displayObject: DisplayObject) {
        if (new.target !== Transform) throw new TypeError("Transform is not extensible");
        if (!isFlashDisplayObject(displayObject)) throw new TypeError("displayObject must be a DisplayObject");
        TRANSFORM_VALUES.set(this, displayObject);
        Object.seal(this);
    }

    get matrix(): Matrix { return localMatrix(targetFor(this)); }
    set matrix(value: Matrix) {
        const target = targetFor(this);
        if (!isFlashMatrix(value)) throw new TypeError("matrix must be a Matrix");
        setNativeMatrix(target, new LayaMatrix(value.a, value.b, value.c, value.d, value.tx, value.ty));
    }

    get concatenatedMatrix(): Matrix {
        const value = targetFor(this).globalTrans.getMatrix();
        return new Matrix(value.a, value.b, value.c, value.d, value.tx, value.ty);
    }

    get colorTransform(): ColorTransform { return synchronizedColor(targetFor(this)); }
    set colorTransform(value: ColorTransform) {
        const target = targetFor(this);
        if (!isFlashColorTransform(value)) throw new TypeError("colorTransform must be a ColorTransform");
        const quantized = quantizedDisplayColor(value);
        DISPLAY_COLORS.set(target, quantized);
        target.alpha = quantized.alphaMultiplier;
        installColorTransform(target, quantized);
    }

    get concatenatedColorTransform(): ColorTransform {
        const chain: DisplayObject[] = [];
        let node: unknown = targetFor(this);
        while (isFlashDisplayObject(node)) {
            chain.unshift(node);
            node = node.parent;
        }
        const result = new ColorTransform();
        for (const item of chain) {
            result.concat(synchronizedColor(item));
            result.redOffset = Math.floor(result.redOffset);
            result.greenOffset = Math.floor(result.greenOffset);
            result.blueOffset = Math.floor(result.blueOffset);
            result.alphaOffset = Math.floor(result.alphaOffset);
        }
        return result;
    }

    copyConcatenatedMatrixToOutput(output: Matrix): void {
        targetFor(this);
        if (!isFlashMatrix(output)) throw new TypeError("output must be a Matrix");
        output.copyFrom(this.concatenatedMatrix);
    }

    copyConcatenatedColorTransformToOutput(output: ColorTransform): void {
        targetFor(this);
        if (!isFlashColorTransform(output)) throw new TypeError("output must be a ColorTransform");
        const value = this.concatenatedColorTransform;
        output.redMultiplier = value.redMultiplier;
        output.greenMultiplier = value.greenMultiplier;
        output.blueMultiplier = value.blueMultiplier;
        output.alphaMultiplier = value.alphaMultiplier;
        output.redOffset = value.redOffset;
        output.greenOffset = value.greenOffset;
        output.blueOffset = value.blueOffset;
        output.alphaOffset = value.alphaOffset;
    }
}

Object.freeze(Transform.prototype);
