import { Event } from "./Event";

/** Flash-shaped text event with an immutable exact native text payload. */
export class TextEvent extends Event {
    static readonly LINK = "link";
    static readonly TEXT_INPUT = "textInput";

    constructor(type: string, bubbles = false, cancelable = false, readonly text = "") {
        super(type, bubbles, cancelable);
        if (typeof text !== "string") throw new TypeError("TextEvent.text must be a string");
    }

    override clone(): TextEvent {
        return new TextEvent(this.type, this.bubbles, this.cancelable, this.text);
    }
}
