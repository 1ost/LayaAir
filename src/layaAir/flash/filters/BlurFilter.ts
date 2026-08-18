import { FlashBlurEffect2D } from "../../laya/display/effect2d/FlashFilterEffects";
import { PostProcess2DEffect } from "../../laya/display/PostProcess2DEffect";
import { BitmapFilter, bitmapFilterNumberEquals } from "./BitmapFilter";
import { flashBlurDimension, flashQuality } from "../../laya/display/effect2d/FlashFilterCoercion";

interface BlurFilterState { blurX: number; blurY: number; quality: number; }
const BLUR_FILTER_VALUES = new WeakMap<object, BlurFilterState>();

function state(value: BlurFilter): BlurFilterState {
    const result = BLUR_FILTER_VALUES.get(value);
    if (!result) throw new TypeError("Invalid BlurFilter receiver");
    return result;
}

export class BlurFilter extends BitmapFilter {
    declare private readonly __blurFilterBrand: void;
    constructor(blurX: number = 4, blurY: number = 4, quality: number = 1) {
        super();
        if (new.target !== BlurFilter) throw new TypeError("BlurFilter is not extensible");
        BLUR_FILTER_VALUES.set(this, {
            blurX: flashBlurDimension(blurX), blurY: flashBlurDimension(blurY), quality: flashQuality(quality),
        });
        if (!Object.prototype.hasOwnProperty.call(this, "_events"))
            Reflect.defineProperty(this, "_events", { value: undefined, writable: true, configurable: true });
        Object.seal(this);
    }

    get blurX(): number { return state(this).blurX; }
    set blurX(value: number) { state(this).blurX = flashBlurDimension(value); this.onChange(); }
    get blurY(): number { return state(this).blurY; }
    set blurY(value: number) { state(this).blurY = flashBlurDimension(value); this.onChange(); }
    get quality(): number { return state(this).quality; }
    set quality(value: number) { state(this).quality = flashQuality(value); this.onChange(); }

    clone(): BlurFilter { return new BlurFilter(this.blurX, this.blurY, this.quality); }
    equals(other: BitmapFilter | null): boolean {
        return isBlurFilter(other)
            && bitmapFilterNumberEquals(this.blurX, other.blurX)
            && bitmapFilterNumberEquals(this.blurY, other.blurY)
            && this.quality === other.quality;
    }
    getEffect(): PostProcess2DEffect {
        return new FlashBlurEffect2D({ blurX: this.blurX, blurY: this.blurY, quality: this.quality });
    }
}

/** Authenticates native values without invoking prototype or Symbol.hasInstance hooks. */
export function isBlurFilter(value: unknown): value is BlurFilter {
    return typeof value === "object" && value !== null && BLUR_FILTER_VALUES.has(value);
}

Object.freeze(BlurFilter.prototype);
