import { Event as LayaEvent } from "../../laya/events/Event";
import { ErrorEvent } from "./ErrorEvent";

const IO_ERROR_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash IO error events. */
export function isFlashIOErrorEvent(value: unknown): value is IOErrorEvent {
    return typeof value === "object" && value !== null && IO_ERROR_EVENT_VALUES.has(value);
}

/** I/O failure surface shared by native loader, sound and WebSocket producers. */
export class IOErrorEvent extends ErrorEvent {
    static readonly DISK_ERROR = "diskError";
    static readonly IO_ERROR = "ioError";
    static readonly NETWORK_ERROR = "networkError";
    static readonly VERIFY_ERROR = "verifyError";

    constructor(type: string, bubbles = false, cancelable = false, text = "", errorID = 0) {
        super(type, bubbles, cancelable, text, errorID);
        IO_ERROR_EVENT_VALUES.add(this);
    }

    override clone(): IOErrorEvent {
        return new IOErrorEvent(this.type, this.bubbles, this.cancelable, this.text, this.errorID);
    }

    /** @internal */
    static _fromNative(type: string, value: unknown): IOErrorEvent {
        const native = value instanceof LayaEvent ? value.nativeEvent ?? value : value;
        if (native instanceof Error) return new IOErrorEvent(type, false, false, native.message, 0);
        if (native === undefined || native === null) return new IOErrorEvent(type);
        if (typeof native !== "object") throw new TypeError(`Native ${type} requires an error payload`);
        const data = native as { text?: unknown; message?: unknown; errorID?: unknown };
        const text = typeof data.text === "string" ? data.text
            : typeof data.message === "string" ? data.message : "";
        const errorID = data.errorID === undefined ? 0 : data.errorID;
        if (!Number.isInteger(errorID) || (errorID as number) < 0 || (errorID as number) > 0xFFFFFFFF)
            throw new TypeError(`Native ${type} errorID must be a uint`);
        return new IOErrorEvent(type, false, false, text, errorID as number);
    }
}
