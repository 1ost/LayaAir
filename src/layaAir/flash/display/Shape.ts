import { Graphics as LayaGraphics } from "../../laya/display/Graphics";
import { DisplayObject } from "./DisplayObject";
import { Graphics, isFlashGraphics } from "./Graphics";

const SHAPE_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash shapes. */
export function isFlashShape(value: unknown): value is Shape {
    return typeof value === "object" && value !== null && SHAPE_VALUES.has(value);
}

/** Source-shaped non-container vector display node backed by native Laya rendering. */
export class Shape extends DisplayObject {
    constructor() {
        super();
        SHAPE_VALUES.add(this);
        this.setGraphics(new Graphics(), true);
    }

    override get graphics(): Graphics {
        if (!isFlashGraphics(this._graphics))
            throw new TypeError("Flash Shape requires the source-shaped Graphics seam");
        return this._graphics;
    }

    override set graphics(value: LayaGraphics) {
        if (!isFlashGraphics(value))
            throw new TypeError("Flash Shape.graphics requires flash.display.Graphics");
        super.graphics = value;
    }
}
