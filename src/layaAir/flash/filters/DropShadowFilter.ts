import { FlashShadowEffect2D } from "../../laya/display/effect2d/FlashFilterEffects";
import { PostProcess2DEffect } from "../../laya/display/PostProcess2DEffect";
import { BitmapFilter, bitmapFilterNumberEquals } from "./BitmapFilter";
import { flashAngle, flashBlurDimension, flashFilterAlpha, flashQuality, flashRgb, flashStrength } from "../../laya/display/effect2d/FlashFilterCoercion";

interface DropShadowFilterState {
    distance: number; angle: number; color: number; alpha: number; blurX: number; blurY: number;
    strength: number; quality: number; inner: boolean; knockout: boolean; hideObject: boolean;
}
const DROP_SHADOW_FILTER_VALUES = new WeakMap<object, DropShadowFilterState>();

function state(value: DropShadowFilter): DropShadowFilterState {
    const result = DROP_SHADOW_FILTER_VALUES.get(value);
    if (!result) throw new TypeError("Invalid DropShadowFilter receiver");
    return result;
}

export class DropShadowFilter extends BitmapFilter {
    declare private readonly __dropShadowFilterBrand: void;
    constructor(
        distance: number = 4, angle: number = 45, color: number = 0, alpha: number = 1,
        blurX: number = 4, blurY: number = 4, strength: number = 1, quality: number = 1,
        inner: boolean = false, knockout: boolean = false, hideObject: boolean = false,
    ) {
        super();
        if (new.target !== DropShadowFilter) throw new TypeError("DropShadowFilter is not extensible");
        DROP_SHADOW_FILTER_VALUES.set(this, {
            distance: Number(distance), angle: flashAngle(angle), color: flashRgb(color),
            alpha: flashFilterAlpha(alpha), blurX: flashBlurDimension(blurX), blurY: flashBlurDimension(blurY),
            strength: flashStrength(strength), quality: flashQuality(quality), inner: Boolean(inner),
            knockout: Boolean(knockout), hideObject: Boolean(hideObject),
        });
        if (!Object.prototype.hasOwnProperty.call(this, "_events"))
            Reflect.defineProperty(this, "_events", { value: undefined, writable: true, configurable: true });
        Object.seal(this);
    }

    get distance(): number { return state(this).distance; }
    set distance(value: number) { state(this).distance = Number(value); this.onChange(); }
    get angle(): number { return state(this).angle; }
    set angle(value: number) { state(this).angle = flashAngle(value); this.onChange(); }
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
    get hideObject(): boolean { return state(this).hideObject; }
    set hideObject(value: boolean) { state(this).hideObject = Boolean(value); this.onChange(); }

    clone(): DropShadowFilter {
        return new DropShadowFilter(this.distance, this.angle, this.color, this.alpha, this.blurX, this.blurY,
            this.strength, this.quality, this.inner, this.knockout, this.hideObject);
    }
    equals(other: BitmapFilter | null): boolean {
        return isDropShadowFilter(other)
            && bitmapFilterNumberEquals(this.distance, other.distance)
            && bitmapFilterNumberEquals(this.angle, other.angle)
            && this.color === other.color
            && bitmapFilterNumberEquals(this.alpha, other.alpha)
            && bitmapFilterNumberEquals(this.blurX, other.blurX)
            && bitmapFilterNumberEquals(this.blurY, other.blurY)
            && bitmapFilterNumberEquals(this.strength, other.strength)
            && this.quality === other.quality && this.inner === other.inner
            && this.knockout === other.knockout && this.hideObject === other.hideObject;
    }
    getEffect(): PostProcess2DEffect {
        return new FlashShadowEffect2D({
            distance: this.distance, angleRadians: this.angle * Math.PI / 180,
            color: this.color, alpha: this.alpha, blurX: this.blurX, blurY: this.blurY,
            strength: this.strength, quality: this.quality, inner: this.inner,
            knockout: this.knockout, hideObject: this.hideObject,
        });
    }
}

/** Authenticates native values without invoking prototype or Symbol.hasInstance hooks. */
export function isDropShadowFilter(value: unknown): value is DropShadowFilter {
    return typeof value === "object" && value !== null && DROP_SHADOW_FILTER_VALUES.has(value);
}

Object.freeze(DropShadowFilter.prototype);
