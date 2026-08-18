import { FLASH_IDENTITY_COLOR_MATRIX, FlashColorMatrixEffect2D } from "../../laya/display/effect2d/FlashFilterEffects";
import { PostProcess2DEffect } from "../../laya/display/PostProcess2DEffect";
import { BitmapFilter, bitmapFilterNumberEquals } from "./BitmapFilter";

const COLOR_MATRIX_FILTER_VALUES = new WeakMap<object, number[]>();

function state(value: ColorMatrixFilter): number[] {
    const result = COLOR_MATRIX_FILTER_VALUES.get(value);
    if (!result) throw new TypeError("Invalid ColorMatrixFilter receiver");
    return result;
}

function normalizeMatrix(value: readonly number[] | null): number[] {
    if (value === null || value === undefined) throw new TypeError("ColorMatrixFilter.matrix cannot be null");
    if (!Array.isArray(value)) throw new TypeError("ColorMatrixFilter.matrix must be an Array");
    const result = new Array<number>(20).fill(0);
    for (let index = 0; index < Math.min(value.length, 20); index++) result[index] = Number(value[index]);
    return result;
}

export class ColorMatrixFilter extends BitmapFilter {
    declare private readonly __colorMatrixFilterBrand: void;
    constructor(matrix: readonly number[] | null = null) {
        super();
        if (new.target !== ColorMatrixFilter) throw new TypeError("ColorMatrixFilter is not extensible");
        COLOR_MATRIX_FILTER_VALUES.set(this, normalizeMatrix(matrix ?? FLASH_IDENTITY_COLOR_MATRIX));
        if (!Object.prototype.hasOwnProperty.call(this, "_events"))
            Reflect.defineProperty(this, "_events", { value: undefined, writable: true, configurable: true });
        Object.seal(this);
    }

    get matrix(): number[] { return state(this).slice(); }
    set matrix(value: number[]) { COLOR_MATRIX_FILTER_VALUES.set(this, normalizeMatrix(value)); this.onChange(); }

    clone(): ColorMatrixFilter { return new ColorMatrixFilter(state(this)); }
    equals(other: BitmapFilter | null): boolean {
        return isColorMatrixFilter(other)
            && state(this).every((value, index) => bitmapFilterNumberEquals(value, state(other)[index]));
    }
    getEffect(): PostProcess2DEffect { return new FlashColorMatrixEffect2D(state(this).slice()); }
}

/** Authenticates native values without invoking prototype or Symbol.hasInstance hooks. */
export function isColorMatrixFilter(value: unknown): value is ColorMatrixFilter {
    return typeof value === "object" && value !== null && COLOR_MATRIX_FILTER_VALUES.has(value);
}

Object.freeze(ColorMatrixFilter.prototype);
