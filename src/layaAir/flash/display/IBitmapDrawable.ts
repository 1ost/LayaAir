import { DisplayObject, isFlashDisplayObject } from "./DisplayObject";

/** Source type presently admitted for real Flash display nodes. Add BitmapData to this union in its own workpack. */
export type IBitmapDrawable = DisplayObject;

/** @internal Plain runtime-lowering predicate; it mints no identity of its own. */
export function isFlashBitmapDrawable(value: unknown): value is IBitmapDrawable {
    return isFlashDisplayObject(value);
}
