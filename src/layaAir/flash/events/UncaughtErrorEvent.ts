import { Event as LayaEvent } from "../../laya/events/Event";
import { ErrorEvent } from "./ErrorEvent";

const UNCAUGHT_ERROR_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash uncaught-error events. */
export function isFlashUncaughtErrorEvent(value: unknown): value is UncaughtErrorEvent {
    return typeof value === "object" && value !== null && UNCAUGHT_ERROR_EVENT_VALUES.has(value);
}

/** Generic uncaught value; global capture, recovery and reporting remain host-owned. */
export class UncaughtErrorEvent extends ErrorEvent {
    static readonly UNCAUGHT_ERROR = "uncaughtError";

    private readonly _error: unknown;

    constructor(type: string, bubbles = true, cancelable = true, error: unknown = null) {
        super(type, bubbles, cancelable, "", 0);
        this._error = error;
        Object.defineProperty(this, "errorID", {
            configurable: false, enumerable: true, writable: false, value: 0
        });
        UNCAUGHT_ERROR_EVENT_VALUES.add(this);
    }

    get error(): unknown { return this._error; }

    override clone(): UncaughtErrorEvent {
        return new UncaughtErrorEvent(this.type, this.bubbles, this.cancelable, this.error);
    }

    /** @internal Projects a host-captured thrown value without installing a global error handler. */
    static _fromNative(type: string, value: unknown): UncaughtErrorEvent {
        const native = value instanceof LayaEvent ? value.nativeEvent ?? value : value;
        if (native && typeof native === "object" && "error" in native)
            return new UncaughtErrorEvent(type, true, true, (native as { error: unknown }).error);
        return new UncaughtErrorEvent(type, true, true, native ?? null);
    }
}

Object.freeze(UncaughtErrorEvent);
