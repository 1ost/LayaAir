import { PostProcess2DEffect } from "../../laya/display/PostProcess2DEffect";
import { Filter as LayaFilter } from "../../laya/filters/Filter";

/** Native TypeScript value base for the game-facing flash.filters surface. */
export abstract class BitmapFilter extends LayaFilter {
    protected constructor() {
        super();
        if (new.target === BitmapFilter) throw new TypeError("BitmapFilter is not constructible");
    }
    abstract clone(): BitmapFilter;
    abstract equals(other: BitmapFilter | null): boolean;
    abstract getEffect(): PostProcess2DEffect;
}

export function bitmapFilterNumberEquals(left: number, right: number): boolean {
    return left === right || Number.isNaN(left) && Number.isNaN(right);
}
// Concrete modules own their nominal brands; this base intentionally has no registration seam.
