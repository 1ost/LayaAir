import { FlashBevelEffect2D, FlashBevelPlacement } from "../../laya/display/effect2d/FlashBevelEffects";
import { flashAngle, flashBlurDimension, flashFilterAlpha, flashQuality, flashRgb, flashStrength } from "../../laya/display/effect2d/FlashFilterCoercion";
import { PostProcess2DEffect } from "../../laya/display/PostProcess2DEffect";
import { BitmapFilter, bitmapFilterNumberEquals } from "./BitmapFilter";

interface GradientBevelFilterState {
    distance: number;
    angle: number;
    colors: number[] | null;
    alphas: number[] | null;
    ratios: number[] | null;
    blurX: number;
    blurY: number;
    strength: number;
    quality: number;
    type: FlashBevelPlacement;
    knockout: boolean;
}

const GRADIENT_BEVEL_FILTER_VALUES = new WeakMap<object, GradientBevelFilterState>();

function state(value: GradientBevelFilter): GradientBevelFilterState {
    const result = GRADIENT_BEVEL_FILTER_VALUES.get(value);
    if (!result) throw new TypeError("Invalid GradientBevelFilter receiver");
    return result;
}

function requireArray(value: readonly number[] | null, name: string): readonly number[] {
    if (!Array.isArray(value)) throw new TypeError(`GradientBevelFilter.${name} must be a non-null Array`);
    return value;
}

function normalizeColors(value: readonly number[] | null): number[] { return requireArray(value, "colors").map(flashRgb); }
function normalizeAlphas(value: readonly number[] | null): number[] { return requireArray(value, "alphas").map(flashFilterAlpha); }
function normalizeRatios(value: readonly number[] | null): number[] {
    return requireArray(value, "ratios").map(item => Math.trunc(Math.max(0, Math.min(255, Number(item)))));
}
function filterType(value: unknown): FlashBevelPlacement {
    return value === "inner" || value === "outer" ? value : "full";
}
function arraysEqual(left: readonly number[] | null, right: readonly number[] | null): boolean {
    return left === right || Boolean(left && right && left.length === right.length
        && left.every((value, index) => Object.is(value, right[index])));
}

/** Sealed Flash GradientBevelFilter value backed by the native LayaAir bevel effect. */
export class GradientBevelFilter extends BitmapFilter {
    declare private readonly __gradientBevelFilterBrand: void;

    constructor(
        distance: number = 4,
        angle: number = 45,
        colors: readonly number[] | null = null,
        alphas: readonly number[] | null = null,
        ratios: readonly number[] | null = null,
        blurX: number = 4,
        blurY: number = 4,
        strength: number = 1,
        quality: number = 1,
        type: string = "inner",
        knockout: boolean = false,
    ) {
        super();
        if (new.target !== GradientBevelFilter) throw new TypeError("GradientBevelFilter is not extensible");
        GRADIENT_BEVEL_FILTER_VALUES.set(this, {
            distance: Number(distance),
            angle: flashAngle(angle),
            colors: colors === null ? null : normalizeColors(colors),
            alphas: alphas === null ? null : normalizeAlphas(alphas),
            ratios: ratios === null ? null : normalizeRatios(ratios),
            blurX: flashBlurDimension(blurX),
            blurY: flashBlurDimension(blurY),
            strength: flashStrength(strength),
            quality: flashQuality(quality),
            type: filterType(type),
            knockout: Boolean(knockout),
        });
        if (!Object.prototype.hasOwnProperty.call(this, "_events"))
            Reflect.defineProperty(this, "_events", { value: undefined, writable: true, configurable: true });
        Object.seal(this);
    }

    get distance(): number { return state(this).distance; }
    set distance(value: number) { state(this).distance = Number(value); this.onChange(); }
    get angle(): number { return state(this).angle; }
    set angle(value: number) { state(this).angle = flashAngle(value); this.onChange(); }
    get colors(): number[] | null { return state(this).colors?.slice() ?? null; }
    set colors(value: number[] | null) { state(this).colors = normalizeColors(value); this.onChange(); }
    get alphas(): number[] | null { return state(this).alphas?.slice() ?? null; }
    set alphas(value: number[] | null) { state(this).alphas = normalizeAlphas(value); this.onChange(); }
    get ratios(): number[] | null { return state(this).ratios?.slice() ?? null; }
    set ratios(value: number[] | null) { state(this).ratios = normalizeRatios(value); this.onChange(); }
    get blurX(): number { return state(this).blurX; }
    set blurX(value: number) { state(this).blurX = flashBlurDimension(value); this.onChange(); }
    get blurY(): number { return state(this).blurY; }
    set blurY(value: number) { state(this).blurY = flashBlurDimension(value); this.onChange(); }
    get strength(): number { return state(this).strength; }
    set strength(value: number) { state(this).strength = flashStrength(value); this.onChange(); }
    get quality(): number { return state(this).quality; }
    set quality(value: number) { state(this).quality = flashQuality(value); this.onChange(); }
    get type(): string { return state(this).type; }
    set type(value: string) { state(this).type = filterType(value); this.onChange(); }
    get knockout(): boolean { return state(this).knockout; }
    set knockout(value: boolean) { state(this).knockout = Boolean(value); this.onChange(); }

    clone(): GradientBevelFilter {
        return new GradientBevelFilter(
            this.distance, this.angle, this.colors, this.alphas, this.ratios,
            this.blurX, this.blurY, this.strength, this.quality, this.type, this.knockout,
        );
    }

    equals(other: BitmapFilter | null): boolean {
        return isGradientBevelFilter(other)
            && bitmapFilterNumberEquals(this.distance, other.distance)
            && bitmapFilterNumberEquals(this.angle, other.angle)
            && arraysEqual(this.colors, other.colors)
            && arraysEqual(this.alphas, other.alphas)
            && arraysEqual(this.ratios, other.ratios)
            && bitmapFilterNumberEquals(this.blurX, other.blurX)
            && bitmapFilterNumberEquals(this.blurY, other.blurY)
            && bitmapFilterNumberEquals(this.strength, other.strength)
            && this.quality === other.quality && this.type === other.type && this.knockout === other.knockout;
    }

    getEffect(): PostProcess2DEffect {
        return new FlashBevelEffect2D({
            distance: this.distance,
            angleRadians: this.angle * Math.PI / 180,
            colors: this.colors,
            alphas: this.alphas,
            ratios: this.ratios,
            blurX: this.blurX,
            blurY: this.blurY,
            strength: this.strength,
            quality: this.quality,
            type: state(this).type,
            knockout: this.knockout,
            compositeSource: true,
        });
    }
}

/** Authenticates native values without invoking prototype or Symbol.hasInstance hooks. */
export function isGradientBevelFilter(value: unknown): value is GradientBevelFilter {
    return typeof value === "object" && value !== null && GRADIENT_BEVEL_FILTER_VALUES.has(value);
}

Object.freeze(GradientBevelFilter.prototype);
