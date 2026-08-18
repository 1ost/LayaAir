import { Event } from "./Event";

const FOCUS_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash focus events. */
export function isFlashFocusEvent(value: unknown): value is FocusEvent {
    return typeof value === "object" && value !== null && FOCUS_EVENT_VALUES.has(value);
}

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
        FOCUS_EVENT_VALUES.add(this);
    }

    override clone(): FocusEvent {
        return new FocusEvent(this.type, this.bubbles, this.cancelable, this.relatedObject,
            this.shiftKey, this.keyCode, this.isRelatedObjectInaccessible);
    }
}

Object.freeze(FocusEvent);
