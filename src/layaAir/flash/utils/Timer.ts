import { ILaya } from "../../ILaya";
import { Timer as LayaTimer } from "../../laya/utils/Timer";
import { EventDispatcher } from "../events/EventDispatcher";
import { TimerEvent } from "../events/TimerEvent";

interface TimerState {
    delay: number;
    repeatCount: number;
    currentCount: number;
    running: boolean;
    generation: number;
    scheduler: LayaTimer | null;
    activeTick: { completionOwed: boolean; reset: boolean } | null;
}

const TIMER_VALUES = new WeakSet<object>();
const TIMER_STATES = new WeakMap<object, TimerState>();

function stateFor(value: object): TimerState {
    const state = TIMER_STATES.get(value);
    if (!state) throw new TypeError("Illegal flash.utils.Timer receiver");
    return state;
}

function checkedDelay(value: number): number {
    if (!Number.isFinite(value) || value < 0)
        throw new RangeError("flash.utils.Timer delay must be a finite non-negative number");
    return value;
}

/** @internal Read-only nominal proof for canonical Flash timers. */
export function isFlashTimer(value: unknown): value is Timer {
    return typeof value === "object" && value !== null && TIMER_VALUES.has(value)
        && Object.getPrototypeOf(value) === Timer.prototype;
}

/**
 * Flash-compatible event timer scheduled by Laya's unscaled system clock.
 *
 * The timer deliberately does not seal its instance: the inherited Laya
 * EventDispatcher surface lazily creates its native listener table.
 */
export class Timer extends EventDispatcher {
    constructor(delay: number, repeatCount = 0) {
        if (new.target !== Timer) throw new TypeError("flash.utils.Timer cannot be subclassed");
        const exactDelay = checkedDelay(delay);
        super();
        TIMER_VALUES.add(this);
        TIMER_STATES.set(this, {
            delay: exactDelay,
            repeatCount: repeatCount | 0,
            currentCount: 0,
            running: false,
            generation: 0,
            scheduler: null,
            activeTick: null
        });
        for (const name of ["reset", "start", "stop"] as const) {
            Object.defineProperty(this, name, {
                value: Timer.prototype[name].bind(this),
                writable: false,
                enumerable: false,
                configurable: false
            });
        }
    }

    get currentCount(): number { return stateFor(this).currentCount; }

    get delay(): number { return stateFor(this).delay; }
    set delay(value: number) {
        const exactDelay = checkedDelay(value);
        const state = stateFor(this);
        state.delay = exactDelay;
        if (!state.running) return;
        this._disarm(state);
        this._arm(state);
    }

    get repeatCount(): number { return stateFor(this).repeatCount; }
    set repeatCount(value: number) {
        const state = stateFor(this);
        state.repeatCount = value | 0;
        if (state.activeTick)
            state.activeTick.completionOwed = state.repeatCount !== 0 && state.currentCount >= state.repeatCount;
        if (state.running && state.repeatCount !== 0 && state.currentCount >= state.repeatCount)
            this._disarm(state);
    }

    get running(): boolean { return stateFor(this).running; }

    reset(): void {
        const state = stateFor(this);
        if (state.activeTick) {
            state.activeTick.reset = true;
            state.activeTick.completionOwed = false;
        }
        try {
            if (state.running) this._disarm(state);
        } finally {
            state.currentCount = 0;
        }
    }

    start(): void {
        const state = stateFor(this);
        if (state.running) return;
        if (state.repeatCount !== 0 && state.currentCount >= state.repeatCount) return;
        this._arm(state);
    }

    stop(): void {
        const state = stateFor(this);
        if (state.running) this._disarm(state);
    }

    private _arm(state: TimerState): void {
        const scheduler = ILaya.systemTimer;
        if (!scheduler) throw new Error("Laya system timer is unavailable for flash.utils.Timer");
        const generation = state.generation + 1;
        state.generation = generation;
        state.running = true;
        state.scheduler = scheduler;
        try {
            if (state.delay === 0)
                scheduler.frameLoop(1, this, this._tick, [generation], true);
            else
                scheduler.loop(state.delay, this, this._tick, [generation], true, false);
        } catch (error) {
            state.generation++;
            state.running = false;
            state.scheduler = null;
            try { scheduler.clear(this, this._tick); } catch { /* Preserve the registration error. */ }
            throw error;
        }
    }

    private _disarm(state: TimerState): void {
        const scheduler = state.scheduler;
        state.generation++;
        state.running = false;
        state.scheduler = null;
        if (scheduler) scheduler.clear(this, this._tick);
    }

    private _tick(generation: number): void {
        const state = stateFor(this);
        if (!state.running || state.generation !== generation) return;
        state.currentCount = (state.currentCount + 1) | 0;
        const tick = {
            completionOwed: state.repeatCount !== 0 && state.currentCount >= state.repeatCount,
            reset: false
        };
        state.activeTick = tick;
        try {
            this.dispatchEvent(new TimerEvent(TimerEvent.TIMER));
        } finally {
            if (state.activeTick === tick) state.activeTick = null;
        }
        if (!tick.reset && tick.completionOwed) {
            if (state.running) this._disarm(state);
            this.dispatchEvent(new TimerEvent(TimerEvent.TIMER_COMPLETE));
        }
    }
}
