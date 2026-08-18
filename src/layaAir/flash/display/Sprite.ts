import { DisplayObjectContainer } from "./DisplayObjectContainer";

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
    }

    buttonMode: boolean = false;
    useHandCursor: boolean = true;
}
