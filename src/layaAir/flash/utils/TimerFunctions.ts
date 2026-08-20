type HostTimerHandle = unknown;
type HostSchedule = (callback: () => void, delay: number) => HostTimerHandle;
type HostClear = (handle: HostTimerHandle) => void;

interface FlashTimerEntry {
    readonly id: number;
    readonly generation: number;
    readonly kind: "timeout" | "interval";
    readonly callback: (...args: any[]) => unknown;
    readonly args: readonly unknown[];
    readonly hostClear: HostClear;
    active: boolean;
    hostHandle: HostTimerHandle | typeof NO_HOST_HANDLE;
}

const MAX_SIGNED_TIMER_ID = 0x7fffffff;
const NO_HOST_HANDLE = Symbol("flash timer has no host handle");
const ACTIVE_TIMERS = new Map<number, FlashTimerEntry>();
let nextTimerId = 1;
let nextGeneration = 1;

function createClock(): () => number {
    const clock = globalThis.performance;
    const now = clock?.now;
    if (typeof now === "function") return () => Reflect.apply(now, clock, []);
    let lastFallbackValue = Date.now();
    return () => {
        lastFallbackValue = Math.max(lastFallbackValue, Date.now());
        return lastFallbackValue;
    };
}

const hostClock = createClock();

function readClock(): number {
    const value = hostClock();
    if (!Number.isFinite(value)) throw new Error("A finite monotonic host clock is required by flash.utils.getTimer");
    return value;
}

const timerOrigin = readClock();
let lastElapsedMilliseconds = 0;

function checkedCallback(value: (...args: any[]) => unknown): (...args: any[]) => unknown {
    if (typeof value !== "function") throw new TypeError("flash.utils timer callback must be a function");
    return value;
}

function checkedDelay(value: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_SIGNED_TIMER_ID)
        throw new RangeError("flash.utils timer delay must be finite and between 0 and 2147483647 milliseconds");
    return value;
}

function allocateTimerId(): number {
    const first = nextTimerId;
    do {
        const candidate = nextTimerId;
        nextTimerId = candidate === MAX_SIGNED_TIMER_ID ? 1 : candidate + 1;
        if (!ACTIVE_TIMERS.has(candidate)) return candidate;
    } while (nextTimerId !== first);
    throw new RangeError("flash.utils timer id space is exhausted");
}

function allocateGeneration(): number {
    const generation = nextGeneration;
    nextGeneration = generation === Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
    return generation;
}

function normalizedTimerId(value: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.trunc(value) >>> 0;
}

function hostBoundary(kind: "timeout" | "interval"): { schedule: HostSchedule; clear: HostClear } {
    const scope = globalThis as unknown as Record<string, unknown>;
    const scheduleName = kind === "timeout" ? "setTimeout" : "setInterval";
    const clearName = kind === "timeout" ? "clearTimeout" : "clearInterval";
    const schedule = scope[scheduleName];
    const clear = scope[clearName];
    if (typeof schedule !== "function" || typeof clear !== "function")
        throw new Error(`Host ${scheduleName}/${clearName} timer boundary is unavailable`);
    return {
        schedule: (callback, delay) => Reflect.apply(schedule, globalThis, [callback, delay]),
        clear: handle => { Reflect.apply(clear, globalThis, [handle]); },
    };
}

function isCurrent(entry: FlashTimerEntry, generation = entry.generation): boolean {
    return entry.active && entry.generation === generation && ACTIVE_TIMERS.get(entry.id) === entry;
}

function retire(entry: FlashTimerEntry, clearHost: boolean): void {
    if (!isCurrent(entry)) return;
    entry.active = false;
    ACTIVE_TIMERS.delete(entry.id);
    const handle = entry.hostHandle;
    entry.hostHandle = NO_HOST_HANDLE;
    if (clearHost && handle !== NO_HOST_HANDLE) entry.hostClear(handle);
}

function cancelTimer(id: number): void {
    const entry = ACTIVE_TIMERS.get(normalizedTimerId(id));
    if (entry) retire(entry, true);
}

function scheduleTimer(kind: "timeout" | "interval", callbackValue: (...args: any[]) => unknown,
    delayValue: number, args: readonly unknown[]): number {
    const callback = checkedCallback(callbackValue);
    const delay = checkedDelay(delayValue);
    const boundary = hostBoundary(kind);
    const id = allocateTimerId();
    const entry: FlashTimerEntry = {
        id,
        generation: allocateGeneration(),
        kind,
        callback,
        args: Object.freeze([...args]),
        hostClear: boundary.clear,
        active: true,
        hostHandle: NO_HOST_HANDLE,
    };
    const generation = entry.generation;
    ACTIVE_TIMERS.set(id, entry);

    const invoke = (): void => {
        if (!isCurrent(entry, generation)) return;
        if (kind === "timeout") retire(entry, false);
        try {
            Reflect.apply(entry.callback, undefined, entry.args);
        } catch (error) {
            if (kind === "interval") {
                try { retire(entry, true); } catch { /* Preserve the callback's primary error. */ }
            }
            throw error;
        }
    };

    try {
        const handle = boundary.schedule(invoke, delay);
        entry.hostHandle = handle;
        if (!isCurrent(entry, generation)) {
            entry.hostHandle = NO_HOST_HANDLE;
            boundary.clear(handle);
        }
        return id;
    } catch (error) {
        if (isCurrent(entry, generation)) retire(entry, false);
        throw error;
    }
}

/**
 * Returns signed 32-bit elapsed milliseconds from this Flash bridge's monotonic
 * module origin. The signed conversion deliberately retains Flash's `int`
 * return surface.
 */
export function getTimer(): number {
    const elapsed = Math.max(lastElapsedMilliseconds, Math.floor(readClock() - timerOrigin));
    lastElapsedMilliseconds = elapsed;
    return elapsed | 0;
}

/** Schedules one callback and returns a host-handle-independent Flash timer id. */
export function setTimeout(callback: (...args: any[]) => unknown, delay: number, ...args: unknown[]): number {
    return scheduleTimer("timeout", callback, delay, args);
}

/** Cancels a timer id. Timeout and interval ids intentionally share one namespace. */
export function clearTimeout(id: number): void {
    cancelTimer(id);
}

/** Schedules a repeating callback and returns a host-handle-independent Flash timer id. */
export function setInterval(callback: (...args: any[]) => unknown, delay: number, ...args: unknown[]): number {
    return scheduleTimer("interval", callback, delay, args);
}

/** Cancels a timer id. Timeout and interval ids intentionally share one namespace. */
export function clearInterval(id: number): void {
    cancelTimer(id);
}

/*
 * Explicit HOLDs: transpiler-owned bound-method lowering, host background-tab
 * throttling, and Flash behavior for delays/elapsed time beyond 2^31-1 remain
 * outside this bridge's admitted authority.
 */
