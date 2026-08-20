interface ColorTransformState {
    redMultiplier: number;
    greenMultiplier: number;
    blueMultiplier: number;
    alphaMultiplier: number;
    redOffset: number;
    greenOffset: number;
    blueOffset: number;
    alphaOffset: number;
}

const COLOR_TRANSFORM_VALUES = new WeakMap<object, ColorTransformState>();

function state(value: ColorTransform): ColorTransformState {
    const result = COLOR_TRANSFORM_VALUES.get(value);
    if (!result) throw new TypeError("Invalid ColorTransform receiver");
    return result;
}

/** @internal Nominal proof for authenticated runtime `is` checks. */
export function isFlashColorTransform(value: unknown): value is ColorTransform {
    return typeof value === "object" && value !== null && COLOR_TRANSFORM_VALUES.has(value);
}

function colorTransformValue(value: ColorTransform, parameter: string): ColorTransformState {
    if (!isFlashColorTransform(value)) throw new TypeError(`${parameter} must be a ColorTransform`);
    return state(value);
}

/** Exact source-visible `flash.geom.ColorTransform` value shape. */
export class ColorTransform {
    constructor(
        redMultiplier = 1,
        greenMultiplier = 1,
        blueMultiplier = 1,
        alphaMultiplier = 1,
        redOffset = 0,
        greenOffset = 0,
        blueOffset = 0,
        alphaOffset = 0,
    ) {
        if (new.target !== ColorTransform) throw new TypeError("ColorTransform is not extensible");
        COLOR_TRANSFORM_VALUES.set(this, {
            redMultiplier: Number(redMultiplier),
            greenMultiplier: Number(greenMultiplier),
            blueMultiplier: Number(blueMultiplier),
            alphaMultiplier: Number(alphaMultiplier),
            redOffset: Number(redOffset),
            greenOffset: Number(greenOffset),
            blueOffset: Number(blueOffset),
            alphaOffset: Number(alphaOffset),
        });
        Object.seal(this);
    }

    get redMultiplier(): number { return state(this).redMultiplier; }
    set redMultiplier(value: number) { state(this).redMultiplier = Number(value); }
    get greenMultiplier(): number { return state(this).greenMultiplier; }
    set greenMultiplier(value: number) { state(this).greenMultiplier = Number(value); }
    get blueMultiplier(): number { return state(this).blueMultiplier; }
    set blueMultiplier(value: number) { state(this).blueMultiplier = Number(value); }
    get alphaMultiplier(): number { return state(this).alphaMultiplier; }
    set alphaMultiplier(value: number) { state(this).alphaMultiplier = Number(value); }
    get redOffset(): number { return state(this).redOffset; }
    set redOffset(value: number) { state(this).redOffset = Number(value); }
    get greenOffset(): number { return state(this).greenOffset; }
    set greenOffset(value: number) { state(this).greenOffset = Number(value); }
    get blueOffset(): number { return state(this).blueOffset; }
    set blueOffset(value: number) { state(this).blueOffset = Number(value); }
    get alphaOffset(): number { return state(this).alphaOffset; }
    set alphaOffset(value: number) { state(this).alphaOffset = Number(value); }

    get color(): number {
        const value = state(this);
        return ((Math.trunc(value.redOffset) & 0xff) << 16)
            | ((Math.trunc(value.greenOffset) & 0xff) << 8)
            | (Math.trunc(value.blueOffset) & 0xff);
    }

    set color(input: number) {
        const value = state(this);
        const color = Number(input) >>> 0;
        value.redMultiplier = value.greenMultiplier = value.blueMultiplier = 0;
        value.redOffset = color >>> 16 & 0xff;
        value.greenOffset = color >>> 8 & 0xff;
        value.blueOffset = color & 0xff;
    }

    clone(): ColorTransform {
        const value = state(this);
        return new ColorTransform(
            value.redMultiplier, value.greenMultiplier, value.blueMultiplier, value.alphaMultiplier,
            value.redOffset, value.greenOffset, value.blueOffset, value.alphaOffset,
        );
    }

    concat(second: ColorTransform): void {
        const current = state(this);
        const value = colorTransformValue(second, "second");
        current.redOffset += value.redOffset * current.redMultiplier;
        current.greenOffset += value.greenOffset * current.greenMultiplier;
        current.blueOffset += value.blueOffset * current.blueMultiplier;
        current.alphaOffset += value.alphaOffset * current.alphaMultiplier;
        current.redMultiplier *= value.redMultiplier;
        current.greenMultiplier *= value.greenMultiplier;
        current.blueMultiplier *= value.blueMultiplier;
        current.alphaMultiplier *= value.alphaMultiplier;
    }

    toString(): string {
        const value = state(this);
        return `(redMultiplier=${value.redMultiplier}, greenMultiplier=${value.greenMultiplier}, blueMultiplier=${value.blueMultiplier}, alphaMultiplier=${value.alphaMultiplier}, redOffset=${value.redOffset}, greenOffset=${value.greenOffset}, blueOffset=${value.blueOffset}, alphaOffset=${value.alphaOffset})`;
    }
}

Object.freeze(ColorTransform.prototype);
