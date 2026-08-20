import { Event as LayaEvent } from "../../laya/events/Event";
import { Event } from "./Event";

const PROGRESS_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash progress events. */
export function isFlashProgressEvent(value: unknown): value is ProgressEvent {
    return typeof value === "object" && value !== null && PROGRESS_EVENT_VALUES.has(value);
}

/** Source-shaped byte progress value; native Loader and socket producers remain separate owners. */
export class ProgressEvent extends Event {
    static readonly PROGRESS = "progress";
    static readonly SOCKET_DATA = "socketData";

    private _bytesLoaded = 0;
    private _bytesTotal = 0;

    constructor(type: string, bubbles = false, cancelable = false, bytesLoaded = 0, bytesTotal = 0) {
        super(type, bubbles, cancelable);
        this.bytesLoaded = bytesLoaded;
        this.bytesTotal = bytesTotal;
        PROGRESS_EVENT_VALUES.add(this);
    }

    get bytesLoaded(): number { return this._bytesLoaded; }
    set bytesLoaded(value: number) { this._bytesLoaded = Number(value); }
    get bytesTotal(): number { return this._bytesTotal; }
    set bytesTotal(value: number) { this._bytesTotal = Number(value); }

    override clone(): ProgressEvent {
        return new ProgressEvent(this.type, this.bubbles, this.cancelable, this.bytesLoaded, this.bytesTotal);
    }

    /** @internal Projects producer-owned progress data without implementing a producer. */
    static _fromNative(type: string, value: unknown): ProgressEvent {
        const native = value instanceof LayaEvent ? value.nativeEvent ?? value : value;
        if (native === undefined || native === null) return new ProgressEvent(type);
        if (typeof native !== "object") throw new TypeError(`Native ${type} requires a progress payload`);
        const data = native as { bytesLoaded?: unknown; bytesTotal?: unknown };
        return new ProgressEvent(type, false, false,
            data.bytesLoaded === undefined ? 0 : data.bytesLoaded as number,
            data.bytesTotal === undefined ? 0 : data.bytesTotal as number);
    }
}

Object.freeze(ProgressEvent);
