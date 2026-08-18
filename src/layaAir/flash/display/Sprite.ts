import { Graphics as LayaGraphics } from "../../laya/display/Graphics";
import { DisplayObjectContainer } from "./DisplayObjectContainer";
import { Graphics, isFlashGraphics } from "./Graphics";

const SPRITE_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash sprites. */
export function isFlashSprite(value: unknown): value is Sprite {
    return typeof value === "object" && value !== null && SPRITE_VALUES.has(value);
}

/** Source-shaped `flash.display.Sprite`, still a native Laya display node. */
export class Sprite extends DisplayObjectContainer {
    constructor() {
        super();
        SPRITE_VALUES.add(this);
        this.setGraphics(new Graphics(), true);
    }

    override get graphics(): Graphics {
        if (!isFlashGraphics(this._graphics))
            throw new TypeError("Flash Sprite requires the source-shaped Graphics seam");
        return this._graphics;
    }

    override set graphics(value: LayaGraphics) {
        if (!isFlashGraphics(value))
            throw new TypeError("Flash Sprite.graphics requires flash.display.Graphics");
        super.graphics = value;
    }

    buttonMode: boolean = false;
    useHandCursor: boolean = true;
}
