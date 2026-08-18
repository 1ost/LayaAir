import { DisplayObject, isFlashDisplayObject } from "./DisplayObject";
import { isFlashBitmapData, type BitmapData } from "./BitmapData";

/** Exact source-visible Flash drawable union; it owns no identity separate from its members. */
export type IBitmapDrawable = DisplayObject | BitmapData;

/** @internal Plain runtime-lowering predicate; it mints no identity of its own. */
export function isFlashBitmapDrawable(value: unknown): value is IBitmapDrawable {
    return isFlashDisplayObject(value) || isFlashBitmapData(value);
}
