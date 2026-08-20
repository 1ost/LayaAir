import assert from "node:assert/strict";
import test from "node:test";
import type {
    FlashGlobalErrorObservation,
    FlashGlobalErrorReceiver,
} from "../../src/layaAir/flash/browser/FlashGlobalErrorBoundary";

class FakeWindow {
    readonly operations: string[] = [];
    readonly listeners = new Map<string, Set<EventListener>>();
    failAdd: string | null = null;
    failRemove: string | null = null;

    addEventListener(type: "error" | "unhandledrejection", listener: EventListener): void {
        this.operations.push(`add:${type}`);
        if (this.failAdd === type) throw new Error(`add ${type} failed`);
        let listeners = this.listeners.get(type);
        if (!listeners) this.listeners.set(type, listeners = new Set());
        listeners.add(listener);
    }

    removeEventListener(type: "error" | "unhandledrejection", listener: EventListener): void {
        this.operations.push(`remove:${type}`);
        if (this.failRemove === type) throw new Error(`remove ${type} failed`);
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type: "error" | "unhandledrejection", event: Event): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, event);
    }

    listenerCount(type: "error" | "unhandledrejection"): number {
        return this.listeners.get(type)?.size ?? 0;
    }

    reset(): this {
        this.operations.length = 0;
        this.listeners.clear();
        this.failAdd = null;
        this.failRemove = null;
        return this;
    }
}

// Install the test realm's sole Window before module evaluation so the module
// captures it once, exactly as a browser realm captures its native Window.
const canonicalTarget = new FakeWindow();
Object.defineProperty(globalThis, "window", { value: canonicalTarget, configurable: true });
const { FlashGlobalErrorBoundary } = await import("../../src/layaAir/flash/browser/FlashGlobalErrorBoundary");
Reflect.deleteProperty(globalThis, "window");

function target(): FakeWindow {
    return canonicalTarget.reset();
}

function subscribe(receiver: FlashGlobalErrorReceiver) {
    return FlashGlobalErrorBoundary.subscribe(canonicalTarget as unknown as Window, receiver);
}

function errorEvent(error: unknown, cancelable = true): Event {
    return Object.assign(new Event("error", { cancelable }), { error });
}

function rejectionEvent(reason: unknown, cancelable = true): Event {
    return Object.assign(new Event("unhandledrejection", { cancelable }), { reason });
}

test("requires an explicit target and receiver without ambient fallback", () => {
    const currentTarget = target();
    assert.throws(
        () => FlashGlobalErrorBoundary.subscribe(undefined as never, () => undefined),
        /explicit canonical Window/,
    );
    assert.throws(() => subscribe(undefined as never), /receiver must be a function/);
    assert.deepEqual(currentTarget.operations, []);
});

test("rejects generic and structurally spoofed event targets", () => {
    target();
    const genericTarget = new EventTarget();
    assert.throws(
        () => FlashGlobalErrorBoundary.subscribe(genericTarget as unknown as Window, () => undefined),
        /explicit canonical Window/,
    );
    const spoofedWindow = new FakeWindow();
    Object.assign(spoofedWindow, { window: spoofedWindow, self: spoofedWindow, document: { defaultView: spoofedWindow } });
    assert.throws(
        () => FlashGlobalErrorBoundary.subscribe(spoofedWindow as unknown as Window, () => undefined),
        /explicit canonical Window/,
    );
});

test("preserves native event and payload identity, route order, and cancellation observation", () => {
    const currentTarget = target();
    const reports: FlashGlobalErrorObservation[] = [];
    const lease = subscribe(report => reports.push(report));
    const error = new Error("exact error");
    const reason = Object.freeze({ exact: "reason" });
    const nativeError = errorEvent(error);
    const nativeRejection = rejectionEvent(reason);
    nativeRejection.preventDefault();

    currentTarget.dispatch("error", nativeError);
    currentTarget.dispatch("unhandledrejection", nativeRejection);

    assert.deepEqual(reports.map(report => report.source), ["error", "unhandledrejection"]);
    const errorReport = reports[0];
    assert.equal(errorReport.source, "error");
    if (errorReport.source !== "error") throw new Error("error route type drift");
    assert.equal(errorReport.error, error);
    assert.equal(errorReport.nativeEvent, nativeError);
    assert.equal(errorReport.defaultPrevented, false);
    assert.equal(nativeError.defaultPrevented, false, "the boundary must not cancel native errors");
    const rejectionReport = reports[1];
    assert.equal(rejectionReport.source, "unhandledrejection");
    if (rejectionReport.source !== "unhandledrejection") throw new Error("rejection route type drift");
    assert.equal(rejectionReport.reason, reason);
    assert.equal(rejectionReport.nativeEvent, nativeRejection);
    assert.equal(rejectionReport.defaultPrevented, true);
    assert.ok(reports.every(Object.isFrozen));
    lease.dispose();
});

test("second-listener registration failure rolls the first listener back", () => {
    const currentTarget = target();
    currentTarget.failAdd = "unhandledrejection";
    assert.throws(() => subscribe(() => undefined), /add unhandledrejection failed/);
    assert.deepEqual(currentTarget.operations, ["add:error", "add:unhandledrejection", "remove:error"]);
    assert.equal(currentTarget.listenerCount("error"), 0);
    assert.equal(currentTarget.listenerCount("unhandledrejection"), 0);
});

test("opaque disposal is idempotent and suppresses every later callback", () => {
    const currentTarget = target();
    const reports: FlashGlobalErrorObservation[] = [];
    const lease = subscribe(report => reports.push(report));
    assert.ok(Object.isFrozen(lease));
    assert.deepEqual(Object.keys(lease), []);
    assert.equal(currentTarget.listenerCount("error"), 1);
    assert.equal(currentTarget.listenerCount("unhandledrejection"), 1);

    lease.dispose();
    lease.dispose();
    currentTarget.dispatch("error", errorEvent("disposed"));
    currentTarget.dispatch("unhandledrejection", rejectionEvent("disposed"));

    assert.deepEqual(reports, []);
    assert.equal(currentTarget.listenerCount("error"), 0);
    assert.equal(currentTarget.listenerCount("unhandledrejection"), 0);
    assert.deepEqual(currentTarget.operations.slice(-2), ["remove:error", "remove:unhandledrejection"]);
});

test("receiver failure does not corrupt listener ownership", () => {
    const currentTarget = target();
    const failure = new Error("receiver failed");
    const values: unknown[] = [];
    const lease = subscribe(report => {
        const value = report.source === "error" ? report.error : report.reason;
        values.push(value);
        if (value === "first") throw failure;
    });

    assert.throws(() => currentTarget.dispatch("error", errorEvent("first")), error => error === failure);
    currentTarget.dispatch("error", errorEvent("second"));
    assert.deepEqual(values, ["first", "second"]);
    lease.dispose();
});

test("failed host removal stops delivery and permits deterministic cleanup retry", () => {
    const currentTarget = target();
    let reports = 0;
    const lease = subscribe(() => reports++);
    currentTarget.failRemove = "error";
    assert.throws(() => lease.dispose(), /listener disposal failed/);

    currentTarget.dispatch("error", errorEvent("still physically attached"));
    currentTarget.dispatch("unhandledrejection", rejectionEvent("already removed"));
    assert.equal(reports, 0);
    assert.equal(currentTarget.listenerCount("error"), 1);
    assert.equal(currentTarget.listenerCount("unhandledrejection"), 0);

    currentTarget.failRemove = null;
    lease.dispose();
    lease.dispose();
    assert.equal(currentTarget.listenerCount("error"), 0);
});
