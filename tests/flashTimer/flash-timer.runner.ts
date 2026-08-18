import assert from "node:assert/strict";
import test from "node:test";
import { ILaya } from "../../src/layaAir/ILaya";
import { Timer as LayaTimer } from "../../src/layaAir/laya/utils/Timer";
import { TimerEvent } from "../../src/layaAir/flash/events/TimerEvent";
import { Timer, isFlashTimer } from "../../src/layaAir/flash/utils/Timer";

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
