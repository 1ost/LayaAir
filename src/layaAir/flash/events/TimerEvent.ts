import { UnsupportedFlashFeatureError } from "./UnsupportedFlashFeatureError";
import { Event } from "./Event";

const TIMER_EVENT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash timer events. */
export function isFlashTimerEvent(value: unknown): value is TimerEvent {
    return typeof value === "object" && value !== null && TIMER_EVENT_VALUES.has(value);
}

/** Event value used by the later native Timer scheduler workpack. */
export class TimerEvent extends Event {
    static readonly TIMER = "timer";
    static readonly TIMER_COMPLETE = "timerComplete";

    constructor(type: string, bubbles = false, cancelable = false) {
        super(type, bubbles, cancelable);
        TIMER_EVENT_VALUES.add(this);
    }

    override clone(): TimerEvent {
        return new TimerEvent(this.type, this.bubbles, this.cancelable);
    }

    updateAfterEvent(): void {
        throw new UnsupportedFlashFeatureError("flash.events.TimerEvent.updateAfterEvent", "Laya owns render scheduling");
    }
}
