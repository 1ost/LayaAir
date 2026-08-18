import { FlashShadowEffect2D } from "../../laya/display/effect2d/FlashFilterEffects";
import { PostProcess2DEffect } from "../../laya/display/PostProcess2DEffect";
import { BitmapFilter, bitmapFilterNumberEquals } from "./BitmapFilter";
import { flashBlurDimension, flashFilterAlpha, flashQuality, flashRgb, flashStrength } from "../../laya/display/effect2d/FlashFilterCoercion";

interface GlowFilterState {
    color: number; alpha: number; blurX: number; blurY: number; strength: number;
    quality: number; inner: boolean; knockout: boolean;
}
const GLOW_FILTER_VALUES = new WeakMap<object, GlowFilterState>();

function state(value: GlowFilter): GlowFilterState {
    const result = GLOW_FILTER_VALUES.get(value);
    if (!result) throw new TypeError("Invalid GlowFilter receiver");
    return result;
}

export class GlowFilter extends BitmapFilter {
    declare private readonly __glowFilterBrand: void;
    constructor(
        color: number = 0xff0000,
        alpha: number = 1,
        blurX: number = 6,
        blurY: number = 6,
        strength: number = 2,
        quality: number = 1,
        inner: boolean = false,
        knockout: boolean = false,
    ) {
        super();
        if (new.target !== GlowFilter) throw new TypeError("GlowFilter is not extensible");
        GLOW_FILTER_VALUES.set(this, {
            color: flashRgb(color), alpha: flashFilterAlpha(alpha),
            blurX: flashBlurDimension(blurX), blurY: flashBlurDimension(blurY),
            strength: flashStrength(strength), quality: flashQuality(quality),
            inner: Boolean(inner), knockout: Boolean(knockout),
        });
        if (!Object.prototype.hasOwnProperty.call(this, "_events"))
            Reflect.defineProperty(this, "_events", { value: undefined, writable: true, configurable: true });
        Object.seal(this);
    }

    get color(): number { return state(this).color; }
    set color(value: number) { state(this).color = flashRgb(value); this.onChange(); }
    get alpha(): number { return state(this).alpha; }
    set alpha(value: number) { state(this).alpha = flashFilterAlpha(value); this.onChange(); }
    get blurX(): number { return state(this).blurX; }
    set blurX(value: number) { state(this).blurX = flashBlurDimension(value); this.onChange(); }
    get blurY(): number { return state(this).blurY; }
    set blurY(value: number) { state(this).blurY = flashBlurDimension(value); this.onChange(); }
    get strength(): number { return state(this).strength; }
    set strength(value: number) { state(this).strength = flashStrength(value); this.onChange(); }
    get quality(): number { return state(this).quality; }
    set quality(value: number) { state(this).quality = flashQuality(value); this.onChange(); }
    get inner(): boolean { return state(this).inner; }
    set inner(value: boolean) { state(this).inner = Boolean(value); this.onChange(); }
    get knockout(): boolean { return state(this).knockout; }
    set knockout(value: boolean) { state(this).knockout = Boolean(value); this.onChange(); }

    clone(): GlowFilter {
        return new GlowFilter(this.color, this.alpha, this.blurX, this.blurY, this.strength, this.quality, this.inner, this.knockout);
    }
    equals(other: BitmapFilter | null): boolean {
        return isGlowFilter(other)
            && this.color === other.color
            && bitmapFilterNumberEquals(this.alpha, other.alpha)
            && bitmapFilterNumberEquals(this.blurX, other.blurX)
            && bitmapFilterNumberEquals(this.blurY, other.blurY)
            && bitmapFilterNumberEquals(this.strength, other.strength)
            && this.quality === other.quality && this.inner === other.inner && this.knockout === other.knockout;
    }
    getEffect(): PostProcess2DEffect {
        return new FlashShadowEffect2D({
            distance: 0, angleRadians: Math.PI / 4, color: this.color, alpha: this.alpha,
            blurX: this.blurX, blurY: this.blurY, strength: this.strength, quality: this.quality,
            inner: this.inner, knockout: this.knockout, hideObject: false,
        });
    }
}

/** Authenticates native values without invoking prototype or Symbol.hasInstance hooks. */
export function isGlowFilter(value: unknown): value is GlowFilter {
    return typeof value === "object" && value !== null && GLOW_FILTER_VALUES.has(value);
}

Object.freeze(GlowFilter.prototype);
