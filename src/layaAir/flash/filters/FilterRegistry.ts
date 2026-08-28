import { BitmapFilter } from "./BitmapFilter";
import { BlurFilter, isBlurFilter } from "./BlurFilter";
import { ColorMatrixFilter, isColorMatrixFilter } from "./ColorMatrixFilter";
import { DropShadowFilter, isDropShadowFilter } from "./DropShadowFilter";
import { GlowFilter, isGlowFilter } from "./GlowFilter";
import { GradientBevelFilter, isGradientBevelFilter } from "./GradientBevelFilter";
import { GradientGlowFilter, isGradientGlowFilter } from "./GradientGlowFilter";

export type ConcreteBitmapFilter = BlurFilter | ColorMatrixFilter | DropShadowFilter | GlowFilter
    | GradientBevelFilter | GradientGlowFilter;

/** Closed aggregate of the six read-only concrete predicates. */
export function isBitmapFilter(value: unknown): value is ConcreteBitmapFilter {
    return isBlurFilter(value) || isColorMatrixFilter(value) || isDropShadowFilter(value)
        || isGlowFilter(value) || isGradientBevelFilter(value) || isGradientGlowFilter(value);
}

/** Structural equality used where Flash returns detached filter copies. */
export function bitmapFilterEquals(left: BitmapFilter | null, right: BitmapFilter | null): boolean {
    if (left === right) return left === null || isBitmapFilter(left);
    if (!isBitmapFilter(left) || !isBitmapFilter(right)) return false;
    if (isBlurFilter(left)) return isBlurFilter(right) && left.equals(right);
    if (isColorMatrixFilter(left)) return isColorMatrixFilter(right) && left.equals(right);
    if (isDropShadowFilter(left)) return isDropShadowFilter(right) && left.equals(right);
    if (isGlowFilter(left)) return isGlowFilter(right) && left.equals(right);
    if (isGradientBevelFilter(left)) return isGradientBevelFilter(right) && left.equals(right);
    return isGradientGlowFilter(left) && isGradientGlowFilter(right) && left.equals(right);
}
