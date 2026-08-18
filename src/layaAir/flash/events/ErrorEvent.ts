import { TextEvent } from "./TextEvent";

const ERROR_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash error events. */
export function isFlashErrorEvent(value: unknown): value is ErrorEvent {
    return typeof value === "object" && value !== null && ERROR_EVENT_VALUES.has(value);
}

/** Source-shaped Flash error event with stable text and numeric identity. */
export class ErrorEvent extends TextEvent {
    static readonly ERROR = "error";

    readonly errorID: number;

    constructor(type: string, bubbles = false, cancelable = false, text = "", errorID = 0) {
        super(type, bubbles, cancelable, text);
        if (!Number.isInteger(errorID) || errorID < 0 || errorID > 0xFFFFFFFF)
            throw new TypeError("ErrorEvent.errorID must be a uint");
        this.errorID = errorID;
        ERROR_EVENT_VALUES.add(this);
    }

    override clone(): ErrorEvent {
        return new ErrorEvent(this.type, this.bubbles, this.cancelable, this.text, this.errorID);
    }
}
