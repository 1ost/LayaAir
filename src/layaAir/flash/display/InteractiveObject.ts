import { DisplayObject } from "./DisplayObject";

/** Flash interactive base; Laya Sprite supplies mouseEnabled and hit testing. */
export class InteractiveObject extends DisplayObject {
    doubleClickEnabled: boolean = false;
    needsSoftKeyboard: boolean = false;
    tabEnabled: boolean = false;
    tabIndex: number = -1;
    focusRect: object | boolean | null = null;
}
