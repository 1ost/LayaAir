import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { Loader } from "../../src/layaAir/flash/display/Loader";
import { Event } from "../../src/layaAir/flash/events/Event";
import { FlashEventListener, FlashEventRouter, NativeEventHost } from "../../src/layaAir/flash/events/FlashEventRouter";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;

interface NativeSubscription {
    readonly caller: unknown;
    readonly listener: Function;
}

class TestHost implements NativeEventHost {
    readonly subscriptions = new Map<string, NativeSubscription>();
    onCalls = 0;
    offCalls = 0;
    failNextOff = false;

    on(type: string, caller: unknown, listener: Function): void {
        this.onCalls++;
        this.subscriptions.set(type, { caller, listener });
    }

    off(type: string, caller: unknown, listener: Function): void {
        this.offCalls++;
        if (this.failNextOff) {
            this.failNextOff = false;
            throw new Error("synthetic detach failure");
        }
        const subscription = this.subscriptions.get(type);
        if (subscription?.caller === caller && subscription.listener === listener)
            this.subscriptions.delete(type);
    }

    event(type: string, data?: unknown): boolean {
        const subscription = this.subscriptions.get(type);
        if (!subscription) return false;
        subscription.listener.call(subscription.caller, data);
        return true;
    }
}

interface WeakCell<T extends object> {
    value: T | undefined;
}

class TestWeakRef<T extends object> {
    static readonly cells: WeakCell<object>[] = [];
    readonly cell: WeakCell<T>;

    constructor(target: T) {
        this.cell = { value: target };
        TestWeakRef.cells.push(this.cell as WeakCell<object>);
    }

    deref(): T | undefined { return this.cell.value; }
}

class TestFinalizationRegistry<HeldValue> {
    static readonly instances: TestFinalizationRegistry<unknown>[] = [];
    readonly records = new Map<object, HeldValue>();
    unregisterCalls = 0;

    constructor(private readonly cleanup: (heldValue: HeldValue) => void) {
        TestFinalizationRegistry.instances.push(this as TestFinalizationRegistry<unknown>);
    }

    register(_target: object, heldValue: HeldValue, unregisterToken?: object): void {
        if (unregisterToken) this.records.set(unregisterToken, heldValue);
    }

    unregister(unregisterToken: object): boolean {
        this.unregisterCalls++;
        return this.records.delete(unregisterToken);
    }

    finalizeFirst(): void {
        const record = this.records.entries().next();
        if (record.done) throw new Error("No registered weak listener to finalize");
        const [token, heldValue] = record.value;
        this.records.delete(token);
        this.cleanup(heldValue);
    }
}

interface WeakMemoryConstructors {
    readonly WeakRef?: typeof TestWeakRef;
    readonly FinalizationRegistry?: typeof TestFinalizationRegistry;
}

function withWeakMemory<T>(constructors: WeakMemoryConstructors, action: () => T): T {
    const weakRef = Object.getOwnPropertyDescriptor(globalThis, "WeakRef");
    const finalizationRegistry = Object.getOwnPropertyDescriptor(globalThis, "FinalizationRegistry");
    TestWeakRef.cells.length = 0;
    TestFinalizationRegistry.instances.length = 0;
    Object.defineProperty(globalThis, "WeakRef", { configurable: true, writable: true, value: constructors.WeakRef });
    Object.defineProperty(globalThis, "FinalizationRegistry", {
        configurable: true, writable: true, value: constructors.FinalizationRegistry,
    });
    try {
        return action();
    } finally {
        if (weakRef) Object.defineProperty(globalThis, "WeakRef", weakRef);
        else delete (globalThis as Record<string, unknown>).WeakRef;
        if (finalizationRegistry) Object.defineProperty(globalThis, "FinalizationRegistry", finalizationRegistry);
        else delete (globalThis as Record<string, unknown>).FinalizationRegistry;
    }
}

function activeRegistry(): TestFinalizationRegistry<unknown> {
    const registry = TestFinalizationRegistry.instances.find(candidate => candidate.records.size > 0);
    if (!registry) throw new Error("No active finalization registry");
    return registry;
}

function collectWeakListener(index = 0): void {
    const cell = TestWeakRef.cells[index];
    if (!cell) throw new Error(`No weak listener cell at ${index}`);
    cell.value = undefined;
}

test("FlashEventRouter weak listeners keep duplicate, priority, and phase-snapshot semantics", () => {
    withWeakMemory({ WeakRef: TestWeakRef, FinalizationRegistry: TestFinalizationRegistry }, () => {
        const host = new TestHost();
        const router = new FlashEventRouter(host);
        const calls: string[] = [];
        const late = () => calls.push("late");
        const low = () => calls.push("low");
        const high = () => {
            calls.push("high");
            router.removeEventListener(Event.CHANGE, low);
            router.addEventListener(Event.CHANGE, late, false, 5, true);
        };

        router.addEventListener(Event.CHANGE, low, false, 0);
        router.addEventListener(Event.CHANGE, high, false, 10, true);
        router.addEventListener(Event.CHANGE, high, false, -100, false);
        assert.equal(host.onCalls, 1);

        router.dispatchEvent(new Event(Event.CHANGE));
        assert.deepEqual(calls, ["high", "low"], "removal does not change the current phase snapshot");
        calls.length = 0;
        router.dispatchEvent(new Event(Event.CHANGE));
        assert.deepEqual(calls, ["high", "late"], "addition waits until the next matching phase");
        assert.equal(TestWeakRef.cells.length, 2, "duplicate registration does not allocate another weak entry");
    });
});

test("capture and bubble registrations retain independent weak identities", () => {
    withWeakMemory({ WeakRef: TestWeakRef, FinalizationRegistry: TestFinalizationRegistry }, () => {
        const router = new FlashEventRouter(new TestHost());
        const phases: number[] = [];
        const listener: FlashEventListener = event => phases.push(event.eventPhase);
        router.addEventListener(Event.CHANGE, listener, true, 0, true);
        router.addEventListener(Event.CHANGE, listener, false, 0, true);
        router.addEventListener(Event.CHANGE, listener, true, 100, false);
        router.dispatchEvent(new Event(Event.CHANGE));
        assert.deepEqual(phases, [2, 2]);
        assert.equal(TestWeakRef.cells.length, 2);
    });
});

test("collected weak listeners detach native forwarding and explicit removal unregisters cleanup", () => {
    withWeakMemory({ WeakRef: TestWeakRef, FinalizationRegistry: TestFinalizationRegistry }, () => {
        const host = new TestHost();
        const router = new FlashEventRouter(host);
        const listener = (): void => undefined;
        router.addEventListener(Event.CHANGE, listener, false, 0, true);
        const registry = activeRegistry();
        collectWeakListener();
        registry.finalizeFirst();
        assert.equal(router.hasEventListener(Event.CHANGE), false);
        assert.equal(host.offCalls, 1);
        assert.equal(host.subscriptions.size, 0);

        const second = (): void => undefined;
        router.addEventListener(Event.CHANGE, second, false, 0, true);
        const secondRegistry = activeRegistry();
        router.removeEventListener(Event.CHANGE, second);
        assert.equal(secondRegistry.records.size, 0);
        assert.equal(secondRegistry.unregisterCalls, 1);
        assert.equal(host.offCalls, 2);
    });
});

test("weak cleanup is lazy without FinalizationRegistry and retries a failed finalizer detach", () => {
    withWeakMemory({ WeakRef: TestWeakRef }, () => {
        const host = new TestHost();
        const router = new FlashEventRouter(host);
        router.addEventListener(Event.CHANGE, () => undefined, false, 0, true);
        collectWeakListener();
        assert.equal(host.event(Event.CHANGE), true, "the native dispatch starts while forwarding is subscribed");
        assert.equal(host.offCalls, 1);
        assert.equal(host.subscriptions.size, 0, "dispatch pruning detaches the empty native type");
    });

    withWeakMemory({ WeakRef: TestWeakRef, FinalizationRegistry: TestFinalizationRegistry }, () => {
        const host = new TestHost();
        const router = new FlashEventRouter(host);
        router.addEventListener(Event.CHANGE, () => undefined, false, 0, true);
        host.failNextOff = true;
        collectWeakListener();
        activeRegistry().finalizeFirst();
        assert.equal(host.offCalls, 1, "a finalizer cannot surface the native detach error");
        assert.equal(host.subscriptions.size, 1, "failed detach stays reachable for an explicit retry");
        assert.equal(router.hasEventListener(Event.CHANGE), false);
        assert.equal(host.offCalls, 2);
        assert.equal(host.subscriptions.size, 0);
    });
});

test("dispose unregisters weak cleanup records and detaches each native type once", () => {
    withWeakMemory({ WeakRef: TestWeakRef, FinalizationRegistry: TestFinalizationRegistry }, () => {
        const host = new TestHost();
        const router = new FlashEventRouter(host);
        router.addEventListener(Event.CHANGE, () => undefined, false, 0, true);
        router.addEventListener(Event.RESIZE, () => undefined, false, 0, true);
        const active = TestFinalizationRegistry.instances.filter(candidate => candidate.records.size > 0);
        assert.equal(active.length, 2);
        router.dispose();
        assert.equal(host.offCalls, 2);
        assert.equal(host.subscriptions.size, 0);
        assert(active.every(candidate => candidate.records.size === 0));
        assert.equal(active.reduce((sum, candidate) => sum + candidate.unregisterCalls, 0), 2);
    });
});

test("hosts without WeakRef use deterministic strong retention", () => {
    withWeakMemory({}, () => {
        const host = new TestHost();
        const router = new FlashEventRouter(host);
        let calls = 0;
        const listener = () => calls++;
        router.addEventListener(Event.CHANGE, listener, false, 0, true);
        assert.equal(TestWeakRef.cells.length, 0);
        router.dispatchEvent(new Event(Event.CHANGE));
        assert.equal(calls, 1);
        router.removeEventListener(Event.CHANGE, listener);
        assert.equal(host.offCalls, 1);
    });
});

test("collected listeners do not detach a type that still has a strong listener", () => {
    withWeakMemory({ WeakRef: TestWeakRef, FinalizationRegistry: TestFinalizationRegistry }, () => {
        const host = new TestHost();
        const router = new FlashEventRouter(host);
        let calls = 0;
        const strong = () => calls++;
        router.addEventListener(Event.CHANGE, () => undefined, false, 10, true);
        router.addEventListener(Event.CHANGE, strong);
        collectWeakListener();
        activeRegistry().finalizeFirst();
        assert.equal(host.offCalls, 0);
        router.dispatchEvent(new Event(Event.CHANGE));
        assert.equal(calls, 1);
        router.removeEventListener(Event.CHANGE, strong);
        assert.equal(host.offCalls, 1);
    });
});

test("LoaderInfo uses the shared weak listener ownership and cleanup semantics", () => {
    withWeakMemory({ WeakRef: TestWeakRef, FinalizationRegistry: TestFinalizationRegistry }, () => {
        const loader = new Loader();
        const info = loader.contentLoaderInfo;
        let calls = 0;
        const listener = () => calls++;
        info.addEventListener(Event.CHANGE, listener, false, 10, true);
        info.addEventListener(Event.CHANGE, listener, false, -10, false);
        info.dispatchEvent(new Event(Event.CHANGE));
        assert.equal(calls, 1);
        assert.equal(TestWeakRef.cells.length, 1);
        collectWeakListener();
        activeRegistry().finalizeFirst();
        assert.equal(info.hasEventListener(Event.CHANGE), false);

        const second = (): void => undefined;
        info.addEventListener(Event.CHANGE, second, false, 0, true);
        const registry = activeRegistry();
        info.removeEventListener(Event.CHANGE, second);
        assert.equal(registry.records.size, 0);
        assert.equal(registry.unregisterCalls, 1);
        loader.destroy();
    });
});
