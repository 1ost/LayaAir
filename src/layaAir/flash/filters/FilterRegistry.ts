import { BitmapFilter } from "./BitmapFilter";
import { BlurFilter, isBlurFilter } from "./BlurFilter";
import { ColorMatrixFilter, isColorMatrixFilter } from "./ColorMatrixFilter";
import { DropShadowFilter, isDropShadowFilter } from "./DropShadowFilter";
import { GlowFilter, isGlowFilter } from "./GlowFilter";
import { GradientBevelFilter, isGradientBevelFilter } from "./GradientBevelFilter";

export type ConcreteBitmapFilter = BlurFilter | ColorMatrixFilter | DropShadowFilter | GlowFilter | GradientBevelFilter;

/** Closed aggregate of the five read-only concrete predicates. */
export function isBitmapFilter(value: unknown): value is ConcreteBitmapFilter {
    return isBlurFilter(value) || isColorMatrixFilter(value) || isDropShadowFilter(value)
        || isGlowFilter(value) || isGradientBevelFilter(value);
}

/** Structural equality used where Flash returns detached filter copies. */
export function bitmapFilterEquals(left: BitmapFilter | null, right: BitmapFilter | null): boolean {
    if (left === right) return left === null || isBitmapFilter(left);
    if (!isBitmapFilter(left) || !isBitmapFilter(right)) return false;
    if (isBlurFilter(left)) return isBlurFilter(right) && left.equals(right);
    if (isColorMatrixFilter(left)) return isColorMatrixFilter(right) && left.equals(right);
    if (isDropShadowFilter(left)) return isDropShadowFilter(right) && left.equals(right);
    if (isGlowFilter(left)) return isGlowFilter(right) && left.equals(right);
    return isGradientBevelFilter(left) && isGradientBevelFilter(right) && left.equals(right);
}
