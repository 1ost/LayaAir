import { EventDispatcher as LayaEventDispatcher } from "../../laya/events/EventDispatcher";
import { FlashEventListener, FlashEventRouter } from "./FlashEventRouter";
import { Event } from "./Event";

const EVENT_DISPATCHER_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash event dispatchers. */
export function isFlashEventDispatcher(value: unknown): value is EventDispatcher {
    return typeof value === "object" && value !== null && EVENT_DISPATCHER_VALUES.has(value);
}

export interface IEventDispatcher {
    addEventListener(type: string, listener: FlashEventListener, useCapture?: boolean, priority?: number, useWeakReference?: boolean): void;
    removeEventListener(type: string, listener: FlashEventListener, useCapture?: boolean): void;
    dispatchEvent(event: Event): boolean;
    hasEventListener(type: string): boolean;
    willTrigger(type: string): boolean;
}

/** Source-shaped non-display dispatcher backed by Laya EventDispatcher. */
export class EventDispatcher extends LayaEventDispatcher implements IEventDispatcher {
    private readonly _flashEvents = new FlashEventRouter(this);
    private readonly _flashTarget: IEventDispatcher;

    constructor(target: IEventDispatcher | null = null) {
        super();
        EVENT_DISPATCHER_VALUES.add(this);
        this._flashTarget = target ?? this;
    }

    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        this._flashEvents.addEventListener(type, listener, useCapture, priority, useWeakReference);
    }
    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        this._flashEvents.removeEventListener(type, listener, useCapture);
    }
    dispatchEvent(event: Event): boolean { return this._flashEvents.dispatchOwnedEvent(event, this._flashTarget); }
    hasEventListener(type: string): boolean { return this._flashEvents.hasEventListener(type); }
    willTrigger(type: string): boolean { return this.hasEventListener(type); }
}
