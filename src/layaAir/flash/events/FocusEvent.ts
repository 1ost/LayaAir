import { Event } from "./Event";

/** Flash-shaped focus transition projected from native Laya focus/blur events. */
export class FocusEvent extends Event {
    static readonly FOCUS_IN = "focusIn";
    static readonly FOCUS_OUT = "focusOut";

    constructor(type: string, bubbles = true, cancelable = false,
        readonly relatedObject: unknown = null, readonly shiftKey = false,
        readonly keyCode = 0, readonly isRelatedObjectInaccessible = false) {
        super(type, bubbles, cancelable);
        if (type !== FocusEvent.FOCUS_IN && type !== FocusEvent.FOCUS_OUT)
            throw new TypeError("FocusEvent.type must be focusIn or focusOut");
        if (!Number.isInteger(keyCode) || keyCode < 0)
            throw new TypeError("FocusEvent.keyCode must be a nonnegative integer");
    }

    override clone(): FocusEvent {
        return new FocusEvent(this.type, this.bubbles, this.cancelable, this.relatedObject,
            this.shiftKey, this.keyCode, this.isRelatedObjectInaccessible);
    }
}
