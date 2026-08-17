import { DisplayObject } from "./DisplayObject";

/** Flash interactive base; Laya Sprite supplies mouseEnabled and hit testing. */
export class InteractiveObject extends DisplayObject {
    doubleClickEnabled: boolean = false;
    needsSoftKeyboard: boolean = false;
    tabEnabled: boolean = false;
    tabIndex: number = -1;

}

Object.defineProperty(InteractiveObject, Symbol.hasInstance, {
    configurable: false,
    value(value: unknown): boolean {
        const candidate = value as Partial<InteractiveObject>;
        return value instanceof DisplayObject
            && typeof candidate.doubleClickEnabled === "boolean"
            && typeof candidate.needsSoftKeyboard === "boolean"
            && typeof candidate.tabEnabled === "boolean"
            && typeof candidate.tabIndex === "number";
    }
});
