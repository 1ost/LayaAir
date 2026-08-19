import { Event as LayaEvent } from "../../laya/events/Event";
import { Event } from "./Event";

const HTTP_STATUS_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash HTTP status events. */
export function isFlashHTTPStatusEvent(value: unknown): value is HTTPStatusEvent {
    return typeof value === "object" && value !== null && HTTP_STATUS_EVENT_VALUES.has(value);
}

/** Playerglobal-26 HTTP status value; request execution and response population remain producer-owned. */
export class HTTPStatusEvent extends Event {
    static readonly HTTP_STATUS = "httpStatus";

    private readonly _status: number;
    private _redirected: boolean;

    constructor(type: string, bubbles = false, cancelable = false, status = 0, redirected = false) {
        super(type, bubbles, cancelable);
        this._status = Number(status) | 0;
        this._redirected = !!redirected;
        HTTP_STATUS_EVENT_VALUES.add(this);
    }

    get status(): number { return this._status; }
    get redirected(): boolean { return this._redirected; }
    set redirected(value: boolean) { this._redirected = !!value; }

    override clone(): HTTPStatusEvent {
        return new HTTPStatusEvent(this.type, this.bubbles, this.cancelable, this.status, this.redirected);
    }

    /** @internal Projects producer-owned status data without implementing HTTP loading. */
    static _fromNative(type: string, value: unknown): HTTPStatusEvent {
        const native = value instanceof LayaEvent ? value.nativeEvent ?? value : value;
        if (native === undefined || native === null) return new HTTPStatusEvent(type);
        if (typeof native === "number") return new HTTPStatusEvent(type, false, false, native);
        if (typeof native !== "object") throw new TypeError(`Native ${type} requires an HTTP status payload`);
        const data = native as { status?: unknown; redirected?: unknown };
        return new HTTPStatusEvent(type, false, false,
            data.status === undefined ? 0 : data.status as number,
            data.redirected === undefined ? false : data.redirected as boolean);
    }
}

Object.freeze(HTTPStatusEvent);
