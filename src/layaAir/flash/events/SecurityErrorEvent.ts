import { Event as LayaEvent } from "../../laya/events/Event";
import { ErrorEvent } from "./ErrorEvent";

const SECURITY_ERROR_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash security error events. */
export function isFlashSecurityErrorEvent(value: unknown): value is SecurityErrorEvent {
    return typeof value === "object" && value !== null && SECURITY_ERROR_EVENT_VALUES.has(value);
}

/** Source-shaped security failure value; policy enforcement and network ownership remain external. */
export class SecurityErrorEvent extends ErrorEvent {
    static readonly SECURITY_ERROR = "securityError";

    constructor(type: string, bubbles = false, cancelable = false, text = "", errorID = 0) {
        const storedText = text === null ? null : String(text);
        const storedErrorID = Number(errorID) | 0;
        super(type, bubbles, cancelable, storedText === null ? "" : storedText,
            storedErrorID < 0 ? 0 : storedErrorID);
        if (storedText === null) Object.defineProperty(this, "text", {
            configurable: true, enumerable: true, writable: true, value: null
        });
        Object.defineProperty(this, "errorID", {
            configurable: false, enumerable: true, writable: false, value: storedErrorID
        });
        SECURITY_ERROR_EVENT_VALUES.add(this);
    }

    override clone(): SecurityErrorEvent {
        return new SecurityErrorEvent(this.type, this.bubbles, this.cancelable, this.text, this.errorID);
    }

    /** @internal Projects producer-owned security failures without implementing policy or transport. */
    static _fromNative(type: string, value: unknown): SecurityErrorEvent {
        const native = value instanceof LayaEvent ? value.nativeEvent ?? value : value;
        if (native instanceof Error) return new SecurityErrorEvent(type, false, false, native.message, 0);
        if (native === undefined || native === null) return new SecurityErrorEvent(type);
        if (typeof native !== "object") throw new TypeError(`Native ${type} requires a security-error payload`);
        const data = native as { text?: unknown; message?: unknown; errorID?: unknown };
        const text = data.text !== undefined ? data.text
            : data.message !== undefined ? data.message : "";
        return new SecurityErrorEvent(type, false, false, text as string,
            (data.errorID === undefined ? 0 : data.errorID) as number);
    }
}

Object.freeze(SecurityErrorEvent);
