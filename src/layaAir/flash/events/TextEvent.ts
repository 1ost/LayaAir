import { Event } from "./Event";

const TEXT_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash text events. */
export function isFlashTextEvent(value: unknown): value is TextEvent {
    return typeof value === "object" && value !== null && TEXT_EVENT_VALUES.has(value);
}

/** Flash-shaped text event with an immutable exact native text payload. */
export class TextEvent extends Event {
    static readonly LINK = "link";
    static readonly TEXT_INPUT = "textInput";

    constructor(type: string, bubbles = false, cancelable = false, public text = "") {
        super(type, bubbles, cancelable);
        if (typeof text !== "string") throw new TypeError("TextEvent.text must be a string");
        TEXT_EVENT_VALUES.add(this);
    }

    override clone(): TextEvent {
        return new TextEvent(this.type, this.bubbles, this.cancelable, this.text);
    }
}

Object.freeze(TextEvent);
