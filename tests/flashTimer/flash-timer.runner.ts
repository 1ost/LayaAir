import assert from "node:assert/strict";
import test from "node:test";
import { ILaya } from "../../src/layaAir/ILaya";
import { Timer as LayaTimer } from "../../src/layaAir/laya/utils/Timer";
import { TimerEvent } from "../../src/layaAir/flash/events/TimerEvent";
import { Timer, isFlashTimer } from "../../src/layaAir/flash/utils/Timer";
import {
    getTimer, setTimeout as flashSetTimeout, clearTimeout as flashClearTimeout,
    setInterval as flashSetInterval, clearInterval as flashClearInterval,
} from "../../src/layaAir/flash/utils/TimerFunctions";
import * as timerFunctions from "../../src/layaAir/flash/utils/TimerFunctions";

interface Registration {
    active: boolean;
    lane: "frame" | "time";
    delay: number;
    caller: unknown;
    method: Function;
    args: unknown[];
}

class FakeScheduler {
    readonly registrations: Registration[] = [];
    clearCalls = 0;
    registerError: unknown = null;
    clearError: unknown = null;

    frameLoop(delay: number, caller: unknown, method: Function, args: unknown[] = []): void {
        this.register("frame", delay, caller, method, args);
    }

    loop(delay: number, caller: unknown, method: Function, args: unknown[] = []): void {
        this.register("time", delay, caller, method, args);
    }

    clear(caller: unknown, method: Function): void {
        this.clearCalls++;
        for (const registration of this.registrations)
            if (registration.caller === caller && registration.method === method) registration.active = false;
        if (this.clearError) throw this.clearError;
    }

    fire(registration: Registration): void {
        registration.method.apply(registration.caller, registration.args);
    }

    latest(): Registration {
        const registration = this.registrations.at(-1);
        if (!registration) throw new Error("missing fake scheduler registration");
        return registration;
    }

    private register(lane: "frame" | "time", delay: number, caller: unknown,
        method: Function, args: unknown[]): void {
        const registration = { active: true, lane, delay, caller, method, args: [...args] };
        this.registrations.push(registration);
        if (this.registerError) throw this.registerError;
    }
}

function install(scheduler: FakeScheduler): void {
    ILaya.systemTimer = scheduler as unknown as LayaTimer;
}

test("Timer is privately branded, exact-prototype, and does not seal inherited Laya listeners", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const timer = new Timer(10);
    assert.equal(isFlashTimer(timer), true);
    assert.equal(isFlashTimer(Object.create(Timer.prototype)), false);
    assert.equal(isFlashTimer(new Proxy(timer, {})), false);
    assert.equal(Object.isExtensible(timer), true);
    assert.doesNotThrow(() => timer.on("native-test", () => {}));
    assert.equal(scheduler.registrations.length, 0, "construction must not schedule");
    assert.throws(() => Reflect.construct(Timer, [10], class Derived {}), /cannot be subclassed/);
    assert.throws(() => { class Derived extends Timer {}; return new Derived(10); }, /cannot be subclassed/);
});

test("delay zero uses the next-frame lane and finite positive delays use unscaled time", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const frame = new Timer(0);
    frame.start();
    assert.deepEqual([scheduler.latest().lane, scheduler.latest().delay], ["frame", 1]);
    const timed = new Timer(50);
    timed.start();
    assert.deepEqual([scheduler.latest().lane, scheduler.latest().delay], ["time", 50]);
    assert.throws(() => new Timer(-1), RangeError);
    assert.throws(() => new Timer(Infinity), RangeError);
    assert.throws(() => { timed.delay = NaN; }, RangeError);
});

test("Timer dispatches fresh TIMER then TIMER_COMPLETE with live state and exact target", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const timer = new Timer(10, 2);
    const seen: Array<[string, boolean, number, unknown, unknown, TimerEvent]> = [];
    const record = (event: TimerEvent) => seen.push([
        event.type, timer.running, timer.currentCount, event.target, event.currentTarget, event
    ]);
    timer.addEventListener(TimerEvent.TIMER, record);
    timer.addEventListener(TimerEvent.TIMER_COMPLETE, record);
    timer.start();
    const registration = scheduler.latest();
    scheduler.fire(registration);
    scheduler.fire(registration);
    scheduler.fire(registration);
    assert.deepEqual(seen.map(entry => entry.slice(0, 3)), [
        [TimerEvent.TIMER, true, 1],
        [TimerEvent.TIMER, true, 2],
        [TimerEvent.TIMER_COMPLETE, false, 2]
    ]);
    assert.equal(seen.every(entry => entry[3] === timer && entry[4] === timer), true);
    assert.notEqual(seen[1][5], seen[2][5]);
    assert.equal(timer.running, false);
});

test("finality follows the retained Pepper stop, reset, and repeatCount reentrancy oracle", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const run = (mutate: (timer: Timer) => void, initialRepeat: number): [Timer, string[], Registration] => {
        const timer = new Timer(1, initialRepeat);
        const events: string[] = [];
        timer.addEventListener(TimerEvent.TIMER, () => {
            events.push(`T${timer.currentCount}:${timer.running}`);
            mutate(timer);
        });
        timer.addEventListener(TimerEvent.TIMER_COMPLETE,
            () => events.push(`C${timer.currentCount}:${timer.running}`));
        timer.start();
        const registration = scheduler.latest();
        scheduler.fire(registration);
        return [timer, events, registration];
    };

    const [stopped, stopEvents] = run(timer => timer.stop(), 1);
    assert.deepEqual([stopEvents, stopped.currentCount, stopped.running], [["T1:true", "C1:false"], 1, false]);

    const [reset, resetEvents] = run(timer => timer.reset(), 1);
    assert.deepEqual([resetEvents, reset.currentCount, reset.running], [["T1:true"], 0, false]);

    let zeroMutated = false;
    const [indefinite, indefiniteEvents, indefiniteRegistration] = run(timer => {
        if (!zeroMutated) { zeroMutated = true; timer.repeatCount = 0; }
    }, 1);
    scheduler.fire(indefiniteRegistration);
    indefinite.stop();
    assert.deepEqual([indefiniteEvents, indefinite.currentCount, indefinite.running],
        [["T1:true", "T2:true"], 2, false]);

    let raised = false;
    const [extended, extendedEvents, extendedRegistration] = run(timer => {
        if (!raised) { raised = true; timer.repeatCount = 3; }
    }, 1);
    scheduler.fire(extendedRegistration);
    scheduler.fire(extendedRegistration);
    assert.deepEqual([extendedEvents, extended.currentCount, extended.running],
        [["T1:true", "T2:true", "T3:true", "C3:false"], 3, false]);

    const [equal, equalEvents] = run(timer => { timer.repeatCount = timer.currentCount; }, 3);
    assert.deepEqual([equalEvents, equal.currentCount, equal.running], [["T1:true", "C1:false"], 1, false]);
});

test("unhandled Timer listener errors propagate directly and abort the current dispatch", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const timer = new Timer(1, 1);
    const expected = new Error("timer listener failed");
    const order: string[] = [];
    timer.addEventListener(TimerEvent.TIMER, () => { order.push("throw"); throw expected; }, false, 10);
    timer.addEventListener(TimerEvent.TIMER, () => order.push("lower"), false, 0);
    timer.addEventListener(TimerEvent.TIMER_COMPLETE, () => order.push("complete"));
    timer.start();
    assert.throws(() => scheduler.fire(scheduler.latest()), error => error === expected);
    assert.deepEqual(order, ["throw"]);
    assert.deepEqual([timer.currentCount, timer.running], [1, true]);
});

test("completion listener errors abort lower listeners after final state is committed", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const completionError = new Error("completion failed");
    const timer = new Timer(1, 1);
    const order: string[] = [];
    timer.addEventListener(TimerEvent.TIMER, () => order.push("timer"));
    timer.addEventListener(TimerEvent.TIMER_COMPLETE, () => {
        order.push("complete-throw");
        throw completionError;
    }, false, 10);
    timer.addEventListener(TimerEvent.TIMER_COMPLETE, () => order.push("complete-lower"));
    timer.start();
    assert.throws(() => scheduler.fire(scheduler.latest()), error => error === completionError);
    assert.deepEqual(order, ["timer", "complete-throw"]);
    assert.deepEqual([timer.currentCount, timer.running], [1, false]);
});

test("scheduler-clear errors abort completion after committing stopped state", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const clearError = new Error("clear failed");
    const timer = new Timer(1, 1);
    const order: string[] = [];
    timer.addEventListener(TimerEvent.TIMER, () => {
        order.push("timer");
        scheduler.clearError = clearError;
    });
    timer.addEventListener(TimerEvent.TIMER_COMPLETE, () => order.push("complete"));
    timer.start();
    assert.throws(() => scheduler.fire(scheduler.latest()), error => error === clearError);
    assert.deepEqual(order, ["timer"]);
    assert.deepEqual([timer.currentCount, timer.running], [1, false]);
});

test("stop, reset, delay changes, and repeat changes invalidate retained callbacks", () => {
    const first = new FakeScheduler();
    install(first);
    const timer = new Timer(25);
    let calls = 0;
    timer.addEventListener(TimerEvent.TIMER, () => calls++);
    timer.start();
    const original = first.latest();
    first.fire(original);
    timer.stop();
    first.fire(original);
    assert.deepEqual([calls, timer.currentCount, timer.running], [1, 1, false]);
    timer.start();
    const restarted = first.latest();
    timer.delay = 50;
    const rearmed = first.latest();
    assert.notEqual(rearmed, restarted);
    assert.deepEqual([rearmed.lane, rearmed.delay], ["time", 50]);
    first.fire(restarted);
    assert.equal(calls, 1);
    first.fire(rearmed);
    assert.equal(calls, 2);
    timer.repeatCount = timer.currentCount;
    assert.equal(timer.running, false);
    first.fire(rearmed);
    assert.equal(calls, 2);
    timer.reset();
    assert.equal(timer.currentCount, 0);
});

test("the captured scheduler is cleared transactionally and registration failures stay stopped", () => {
    const first = new FakeScheduler();
    const second = new FakeScheduler();
    install(first);
    const timer = new Timer(10);
    timer.start();
    install(second);
    timer.stop();
    assert.deepEqual([first.clearCalls, second.clearCalls], [1, 0]);

    const failed = new FakeScheduler();
    const expected = new Error("register failed");
    failed.registerError = expected;
    install(failed);
    const rejected = new Timer(10);
    assert.throws(() => rejected.start(), error => error === expected);
    assert.equal(rejected.running, false);
    failed.registerError = null;
    assert.doesNotThrow(() => rejected.start());

    const clearing = new FakeScheduler();
    install(clearing);
    const resetting = new Timer(10);
    resetting.start();
    clearing.fire(clearing.latest());
    clearing.clearError = expected;
    assert.throws(() => resetting.reset(), error => error === expected);
    assert.deepEqual([resetting.currentCount, resetting.running], [0, false]);
    clearing.fire(clearing.latest());
    assert.equal(resetting.currentCount, 0, "the retained callback must be stale after a failed clear");
});

test("start, stop, and reset are stable extracted method closures", () => {
    const scheduler = new FakeScheduler();
    install(scheduler);
    const timer = new Timer(5);
    assert.equal(timer.start, timer.start);
    assert.equal(timer.stop, timer.stop);
    assert.equal(timer.reset, timer.reset);
    const start = timer.start;
    const stop = timer.stop;
    start();
    assert.equal(timer.running, true);
    stop();
    assert.equal(timer.running, false);
});

interface FunctionTimerRegistration {
    readonly kind: "timeout" | "interval";
    readonly callback: () => void;
    readonly delay: number;
    readonly handle: unknown;
    cleared: boolean;
}

class FakeFunctionTimerHost {
    readonly registrations: FunctionTimerRegistration[] = [];
    clearError: unknown = null;
    scheduleError: unknown = null;
    fireDuringSchedule = false;
    throwAfterRegistration: unknown = null;
    readonly scheduleReceivers: unknown[] = [];
    readonly clearReceivers: unknown[] = [];

    schedule(kind: "timeout" | "interval", callback: () => void, delay: number): unknown {
        if (this.scheduleError) throw this.scheduleError;
        const handle = kind === "timeout"
            ? { nodeStyleHandle: this.registrations.length + 1 }
            : 7000 + this.registrations.length;
        const registration = { kind, callback, delay, handle, cleared: false } as FunctionTimerRegistration;
        this.registrations.push(registration);
        if (this.fireDuringSchedule) callback();
        if (this.throwAfterRegistration) throw this.throwAfterRegistration;
        return handle;
    }

    clear(handle: unknown): void {
        const registration = this.registrations.find(item => item.handle === handle);
        if (registration) registration.cleared = true;
        if (this.clearError) throw this.clearError;
    }

    fire(registration: FunctionTimerRegistration): void {
        registration.callback();
    }
}

function installFunctionTimerHost(host: FakeFunctionTimerHost): () => void {
    const originals = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
    };
    globalThis.setTimeout = (function (this: unknown, callback: () => void, delay?: number) {
        host.scheduleReceivers.push(this);
        return host.schedule("timeout", callback, delay ?? 0);
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (function (this: unknown, handle: unknown) {
        host.clearReceivers.push(this);
        host.clear(handle);
    }) as typeof globalThis.clearTimeout;
    globalThis.setInterval = (function (this: unknown, callback: () => void, delay?: number) {
        host.scheduleReceivers.push(this);
        return host.schedule("interval", callback, delay ?? 0);
    }) as typeof globalThis.setInterval;
    globalThis.clearInterval = (function (this: unknown, handle: unknown) {
        host.clearReceivers.push(this);
        host.clear(handle);
    }) as typeof globalThis.clearInterval;
    return () => {
        globalThis.setTimeout = originals.setTimeout;
        globalThis.clearTimeout = originals.clearTimeout;
        globalThis.setInterval = originals.setInterval;
        globalThis.clearInterval = originals.clearInterval;
    };
}

test("timer function module exposes exactly the five admitted runtime names", () => {
    assert.deepEqual(Object.keys(timerFunctions).sort(),
        ["clearInterval", "clearTimeout", "getTimer", "setInterval", "setTimeout"]);
});

test("timer functions expose elapsed signed milliseconds from a local monotonic origin", () => {
    const first = getTimer();
    const second = getTimer();
    assert.equal(Number.isInteger(first), true);
    assert.equal(first >= 0 && first < 0x7fffffff, true, "getTimer must not expose an epoch timestamp");
    assert.equal(second >= first, true);
});

test("timer functions normalize object and numeric host handles into sealed public ids", () => {
    const host = new FakeFunctionTimerHost();
    const restore = installFunctionTimerHost(host);
    try {
        const calls: unknown[][] = [];
        let callbackThis: unknown = globalThis;
        const timeoutId = flashSetTimeout(function (this: unknown, ...args: unknown[]) {
            callbackThis = this;
            calls.push(args);
        }, 12, "a", 2);
        const intervalId = flashSetInterval((...args: unknown[]) => calls.push(args), 7, "i");
        assert.deepEqual([Number.isInteger(timeoutId), Number.isInteger(intervalId), timeoutId > 0,
            intervalId > 0, timeoutId === intervalId], [true, true, true, true, false]);
        assert.notEqual(timeoutId, host.registrations[0].handle);
        assert.notEqual(intervalId, host.registrations[1].handle);
        assert.deepEqual(host.registrations.map(item => [item.kind, item.delay]), [["timeout", 12], ["interval", 7]]);

        host.fire(host.registrations[0]);
        host.fire(host.registrations[0]);
        host.fire(host.registrations[1]);
        host.fire(host.registrations[1]);
        assert.deepEqual(calls, [["a", 2], ["i"], ["i"]]);
        assert.equal(callbackThis, undefined, "callbacks use strict Flash function receiver semantics");
        assert.equal(host.scheduleReceivers.every(receiver => receiver === globalThis), true);

        flashClearTimeout(intervalId);
        assert.equal(host.registrations[1].cleared, true, "the shared id namespace permits cross-clear");
        host.fire(host.registrations[1]);
        assert.deepEqual(calls, [["a", 2], ["i"], ["i"]]);
        flashClearInterval(timeoutId);
        assert.equal(host.registrations[0].cleared, false, "completed timeouts are already retired");
        assert.equal(host.clearReceivers.every(receiver => receiver === globalThis), true);
    } finally {
        restore();
    }
});

test("timer clearing uses the captured host clear function after a global boundary swap", () => {
    const first = new FakeFunctionTimerHost();
    const second = new FakeFunctionTimerHost();
    const restore = installFunctionTimerHost(first);
    try {
        const id = flashSetInterval(() => {}, 1);
        globalThis.clearInterval = (function (this: unknown, handle: unknown) {
            second.clearReceivers.push(this);
            second.clear(handle);
        }) as typeof globalThis.clearInterval;
        flashClearInterval(id);
        assert.equal(first.registrations[0].cleared, true);
        assert.equal(second.clearReceivers.length, 0);
    } finally {
        restore();
    }
});

test("clear commits before host failure and stale generations cannot re-enter", () => {
    const host = new FakeFunctionTimerHost();
    const restore = installFunctionTimerHost(host);
    try {
        let calls = 0;
        const id = flashSetInterval(() => calls++, 1);
        const registration = host.registrations[0];
        host.clearError = new Error("host clear failed");
        assert.throws(() => flashClearInterval(id), error => error === host.clearError);
        host.fire(registration);
        assert.equal(calls, 0);
        assert.doesNotThrow(() => flashClearInterval(id));
    } finally {
        restore();
    }
});

test("reentrant cancellation invalidates the active callback before it can fire again", () => {
    const host = new FakeFunctionTimerHost();
    const restore = installFunctionTimerHost(host);
    try {
        let id = 0;
        let calls = 0;
        id = flashSetInterval(() => {
            calls++;
            flashClearInterval(id);
        }, 1);
        const registration = host.registrations[0];
        host.fire(registration);
        host.fire(registration);
        assert.equal(calls, 1);
        assert.equal(registration.cleared, true);
    } finally {
        restore();
    }
});

test("a synchronously firing host cannot retain a completed timeout generation", () => {
    const host = new FakeFunctionTimerHost();
    host.fireDuringSchedule = true;
    const restore = installFunctionTimerHost(host);
    try {
        let calls = 0;
        const id = flashSetTimeout(() => calls++, 0);
        const registration = host.registrations[0];
        assert.equal(calls, 1);
        assert.equal(registration.cleared, true, "the returned host handle is cleared after synchronous retirement");
        host.fire(registration);
        assert.equal(calls, 1);
        assert.doesNotThrow(() => flashClearTimeout(id));
    } finally {
        restore();
    }
});

test("interval callback errors retire the registration and preserve the primary error", () => {
    const host = new FakeFunctionTimerHost();
    const restore = installFunctionTimerHost(host);
    try {
        const primary = new Error("callback failed");
        host.clearError = new Error("cleanup failed");
        let calls = 0;
        flashSetInterval(() => { calls++; throw primary; }, 3);
        const registration = host.registrations[0];
        assert.throws(() => host.fire(registration), error => error === primary);
        assert.equal(registration.cleared, true);
        assert.doesNotThrow(() => host.fire(registration));
        assert.equal(calls, 1);
    } finally {
        restore();
    }
});

test("timeout callback errors retire before dispatch and preserve the primary error", () => {
    const host = new FakeFunctionTimerHost();
    const restore = installFunctionTimerHost(host);
    try {
        const primary = new Error("timeout callback failed");
        let calls = 0;
        const id = flashSetTimeout(() => { calls++; throw primary; }, 3);
        const registration = host.registrations[0];
        assert.throws(() => host.fire(registration), error => error === primary);
        assert.doesNotThrow(() => flashClearTimeout(id));
        assert.doesNotThrow(() => host.fire(registration));
        assert.equal(calls, 1);
    } finally {
        restore();
    }
});

test("timer function validation and registration failures are atomic", () => {
    const host = new FakeFunctionTimerHost();
    const restore = installFunctionTimerHost(host);
    try {
        assert.throws(() => flashSetTimeout(null as unknown as () => void, 0), TypeError);
        assert.throws(() => flashSetTimeout(() => {}, -1), RangeError);
        assert.throws(() => flashSetInterval(() => {}, Number.POSITIVE_INFINITY), RangeError);
        assert.throws(() => flashSetInterval(() => {}, 0x80000000), RangeError);
        assert.equal(host.registrations.length, 0);

        const expected = new Error("schedule failed");
        host.scheduleError = expected;
        assert.throws(() => flashSetTimeout(() => {}, 0), error => error === expected);
        flashClearTimeout(0xffffffff);
        assert.equal(host.registrations.length, 0);

        host.scheduleError = null;
        host.throwAfterRegistration = expected;
        let staleCalls = 0;
        assert.throws(() => flashSetTimeout(() => staleCalls++, 0), error => error === expected);
        assert.equal(host.registrations.length, 1);
        host.fire(host.registrations[0]);
        assert.equal(staleCalls, 0, "a host-retained callback is fenced after schedule throws");
    } finally {
        restore();
    }
});
