import assert from "node:assert/strict";
import test from "node:test";
import { ILaya } from "../../src/layaAir/ILaya";
import { FlashDisplayRootBoundary, type FlashDisplayRootLease }
    from "../../src/layaAir/flash/display/FlashDisplayRootBoundary";
import { Node as LayaNode } from "../../src/layaAir/laya/display/Node";
import { Stage } from "../../src/layaAir/laya/display/Stage";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { Timer as LayaTimer } from "../../src/layaAir/laya/utils/Timer";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
(PAL as any).browser ??= { on: (): void => undefined };
(PAL as any).textInput ??= { target: null };

interface FrameRegistration {
    readonly caller: unknown;
    readonly method: Function;
    readonly args: unknown[];
    active: boolean;
}

class FakeScheduler {
    readonly registrations: FrameRegistration[] = [];
    frameLoopCalls = 0;
    clearCalls = 0;
    registerError: unknown = null;
    clearError: unknown = null;
    clearThrowsBeforeMutation = false;
    beforeFrameRegistration: (() => void) | null = null;

    frameLoop(delay: number, caller: unknown, method: Function,
        args: unknown[] = [], coverBefore = true): void {
        assert.equal(delay, 1);
        assert.equal(coverBefore, true);
        this.frameLoopCalls++;
        this.beforeFrameRegistration?.();
        const registration = { caller, method, args: [...args], active: true };
        this.registrations.push(registration);
        if (this.registerError) throw this.registerError;
    }

    clear(caller: unknown, method: Function): void {
        this.clearCalls++;
        if (this.clearError && this.clearThrowsBeforeMutation) throw this.clearError;
        for (const registration of this.registrations)
            if (registration.caller === caller && registration.method === method)
                registration.active = false;
        if (this.clearError) throw this.clearError;
    }

    fire(registration: FrameRegistration): void {
        registration.method.apply(registration.caller, registration.args);
    }

    tick(): void {
        for (const registration of this.registrations.filter(item => item.active))
            this.fire(registration);
    }

    latest(): FrameRegistration {
        const registration = this.registrations.at(-1);
        if (!registration) throw new Error("missing frame registration");
        return registration;
    }

    get activeCount(): number {
        return this.registrations.filter(item => item.active).length;
    }
}

class CountingNode extends LayaNode {
    destroyCalls = 0;
    override destroy(destroyChild = true): void {
        this.destroyCalls++;
        super.destroy(destroyChild);
    }
}

class RetryDestroyNode extends CountingNode {
    failDestruction = true;
    beforeDestroy: (() => void) | null = null;
    override destroy(destroyChild = true): void {
        this.destroyCalls++;
        this.beforeDestroy?.();
        if (this.failDestruction) throw new Error("fixture destroy failure");
        LayaNode.prototype.destroy.call(this, destroyChild);
    }
}

function install(stage: Stage, scheduler: FakeScheduler): void {
    ILaya.stage = stage;
    ILaya.timer = scheduler as unknown as LayaTimer;
}

test("claim issues one frozen opaque lease for the exact live Stage", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    try {
        install(stage, scheduler);
        const lease = FlashDisplayRootBoundary.claim(stage, () => undefined);
        assert.equal(Object.isFrozen(lease), true);
        assert.deepEqual([lease.root, lease.attached, lease.disposed], [null, false, false]);
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/);
        const forged = Object.create(Object.getPrototypeOf(lease)) as FlashDisplayRootLease;
        assert.throws(() => forged.attach(new LayaNode()), /engine-issued lease/);
        assert.equal(Object.getOwnPropertyDescriptor(lease, "attach")?.writable, false);
        lease.dispose();
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("the actual Laya Timer schedules through private extensible identity while the lease stays frozen", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const timer = new LayaTimer(false);
    const root = new LayaNode();
    let frames = 0;
    try {
        ILaya.stage = stage;
        ILaya.timer = timer;
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => frames++, {
            destroyRootOnDispose: false
        });
        const publicKeys = Reflect.ownKeys(lease);
        assert.equal(Object.isFrozen(lease), true);
        assert.doesNotThrow(() => lease.attach(root),
            "Laya Utils.getGID must never stamp the frozen public lease");
        assert.deepEqual(Reflect.ownKeys(lease), publicKeys);

        timer._update(performance.now() + 17);
        assert.equal(frames, 1);
        lease.dispose();
        timer._update(performance.now() + 34);
        assert.deepEqual([frames, root.parent, lease.disposed], [1, null, true]);
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("claim rejects alternate, derived, dead, and reentrantly replaced Stages before publication", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    try {
        install(stage, scheduler);
        const alternate = new Stage();
        assert.throws(() => FlashDisplayRootBoundary.claim(alternate, () => undefined), /live canonical/);
        class DerivedStage extends Stage {}
        const derived = new DerivedStage();
        ILaya.stage = derived;
        assert.throws(() => FlashDisplayRootBoundary.claim(derived, () => undefined), /live canonical/);
        ILaya.stage = stage;
        const dead = new Stage(); dead.destroy(); ILaya.stage = dead;
        assert.throws(() => FlashDisplayRootBoundary.claim(dead, () => undefined), /live canonical/);
        ILaya.stage = stage;
        const replacement = new Stage();
        const hostileOptions = Object.defineProperty({}, "destroyRootOnDispose", {
            get(): boolean { ILaya.stage = replacement; return false; }
        });
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined, hostileOptions), /live canonical/);
        ILaya.stage = stage;
        assert.doesNotThrow(() => FlashDisplayRootBoundary.claim(stage, () => undefined).dispose());
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("attachment publishes before one canonical frame subscription and reattachment fences stale callbacks", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new LayaNode();
    const order: string[] = [];
    try {
        install(stage, scheduler);
        root.on("added", () => order.push("added"));
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, attachedRoot => {
            assert.equal(attachedRoot, root);
            assert.equal(attachedRoot.parent, stage);
            order.push("frame");
        }, { destroyRootOnDispose: false });
        assert.equal(lease.attach(root), root);
        assert.deepEqual([lease.root, lease.attached, stage.children.includes(root), scheduler.activeCount],
            [root, true, true, 1]);
        const first = scheduler.latest();
        scheduler.tick();
        assert.deepEqual(order, ["added", "frame"]);
        assert.equal(lease.detach(), root);
        assert.deepEqual([root.parent, lease.attached, scheduler.activeCount], [null, false, 0]);
        lease.attach(root);
        const second = scheduler.latest();
        assert.notEqual(first.args[0], second.args[0]);
        scheduler.fire(first);
        assert.deepEqual(order, ["added", "frame", "added"], "retained callback is generation-fenced");
        scheduler.fire(second);
        assert.deepEqual(order, ["added", "frame", "added", "frame"]);
        assert.equal(scheduler.activeCount, 1);
        lease.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("external removal cancels frames, retains root ownership, and permits exact reattachment", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new LayaNode();
    let frames = 0;
    try {
        install(stage, scheduler);
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => frames++, {
            destroyRootOnDispose: false
        });
        lease.attach(root);
        scheduler.tick();
        stage.removeChild(root);
        assert.deepEqual([lease.root, lease.attached, root.parent, scheduler.activeCount, frames],
            [root, false, null, 0, 1]);
        lease.attach(root);
        scheduler.tick();
        assert.equal(frames, 2);
        lease.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("Laya-isolated removal listener errors cannot strand lifecycle cleanup or application frames", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new LayaNode();
    let frames = 0;
    const expected = new Error("fixture earlier removed listener failure");
    const previousConsoleError = console.error;
    const logged: unknown[] = [];
    try {
        install(stage, scheduler);
        console.error = (value: unknown): void => { logged.push(value); };
        root.on("removed", () => { throw expected; });
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => frames++);
        lease.attach(root);
        assert.doesNotThrow(() => stage.removeChild(root));
        assert.deepEqual([logged, stage.children.includes(root), root.parent, scheduler.activeCount],
            [[expected], false, null, 0]);
        scheduler.tick();
        assert.deepEqual([lease.attached, scheduler.activeCount, frames], [false, 0, 0]);
        root.offAll("removed");
        lease.dispose();
    } finally {
        console.error = previousConsoleError;
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("clear plus removal failure never counterfeits attached state and cleanup retries exactly", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new LayaNode();
    const originalRemove = stage.removeChild.bind(stage);
    let failRemoval = true;
    let removeCalls = 0;
    stage.removeChild = ((node: LayaNode) => {
        removeCalls++;
        if (failRemoval) throw new Error("fixture remove failure");
        return originalRemove(node);
    }) as typeof stage.removeChild;
    try {
        install(stage, scheduler);
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => undefined, {
            destroyRootOnDispose: false
        });
        lease.attach(root);
        scheduler.clearError = new Error("fixture clear failure");
        assert.throws(() => lease.detach(), /fixture clear failure/);
        assert.deepEqual([lease.attached, root.parent, scheduler.activeCount, removeCalls],
            [false, stage, 0, 1], "zero frames must never be published as attached");
        scheduler.clearError = null;
        failRemoval = false;
        assert.equal(lease.detach(), root);
        assert.deepEqual([lease.attached, root.parent, scheduler.activeCount, removeCalls], [false, null, 0, 2]);
        lease.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("clear-before-mutation failure fences a possibly live frame until retry", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new LayaNode();
    const originalRemove = stage.removeChild.bind(stage);
    let failRemoval = true;
    let frames = 0;
    stage.removeChild = ((node: LayaNode) => {
        if (failRemoval) throw new Error("fixture remove failure");
        return originalRemove(node);
    }) as typeof stage.removeChild;
    try {
        install(stage, scheduler);
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => frames++, {
            destroyRootOnDispose: false
        });
        lease.attach(root);
        const retained = scheduler.latest();
        scheduler.clearThrowsBeforeMutation = true;
        scheduler.clearError = new Error("fixture pre-clear failure");
        assert.throws(() => lease.detach(), /fixture pre-clear failure/);
        assert.deepEqual([lease.attached, root.parent, scheduler.activeCount], [false, stage, 1]);
        scheduler.fire(retained);
        assert.equal(frames, 0, "indeterminate host callback is generation-fenced");

        scheduler.clearError = null;
        failRemoval = false;
        assert.equal(lease.detach(), root);
        assert.deepEqual([lease.attached, root.parent, scheduler.activeCount], [false, null, 0]);
        lease.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("clear and listener-removal throws retain cleanup authority until disposal retry", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new LayaNode();
    const originalOff = root.off.bind(root);
    let failAfterRemoval = true;
    root.off = ((type: string, caller: unknown, listener?: Function) => {
        const result = originalOff(type, caller, listener!);
        if (failAfterRemoval) throw new Error("fixture post-listener-removal failure");
        return result;
    }) as typeof root.off;
    try {
        install(stage, scheduler);
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => undefined, {
            destroyRootOnDispose: false
        });
        lease.attach(root);
        scheduler.clearError = new Error("fixture post-clear failure");
        assert.throws(() => lease.dispose(), /fixture post-clear failure/);
        assert.deepEqual([lease.disposed, lease.attached, lease.root, root.parent,
            root.hasListener("removed"), scheduler.activeCount], [false, false, root, null, false, 0]);
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/,
            "indeterminate native cleanup retains the exclusive Stage lease");

        scheduler.clearError = null;
        failAfterRemoval = false;
        lease.dispose();
        assert.deepEqual([lease.disposed, lease.root, root.parent, root.hasListener("removed"),
            scheduler.activeCount], [true, null, null, false, 0]);
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("install-then-throw removal listener is reconciled and its root claim is released", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new LayaNode();
    const originalOn = root.on.bind(root);
    let failAfterInstall = true;
    root.on = ((type: string, caller: unknown, listener?: Function, args?: unknown[]) => {
        const result = originalOn(type, caller, listener!, args);
        if (failAfterInstall) throw new Error("fixture post-install failure");
        return result;
    }) as typeof root.on;
    try {
        install(stage, scheduler);
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => undefined, {
            destroyRootOnDispose: false
        });
        assert.throws(() => lease.attach(root), /fixture post-install failure/);
        assert.deepEqual([lease.root, lease.attached, root.hasListener("removed"), root.parent,
            scheduler.activeCount], [null, false, false, undefined, 0]);

        failAfterInstall = false;
        assert.equal(lease.attach(root), root, "successful reconciliation releases exact root ownership");
        assert.deepEqual([lease.attached, root.hasListener("removed"), scheduler.activeCount],
            [true, true, 1]);
        lease.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("reentrant dispose inside removal-listener on reconciles a listener installed afterward", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new CountingNode();
    const originalOn = root.on.bind(root);
    let lease: FlashDisplayRootLease<CountingNode>;
    root.on = ((type: string, caller: unknown, listener?: Function, args?: unknown[]) => {
        lease.dispose();
        return originalOn(type, caller, listener!, args);
    }) as typeof root.on;
    try {
        install(stage, scheduler);
        lease = FlashDisplayRootBoundary.claim<CountingNode>(stage, () => undefined);
        assert.throws(() => lease.attach(root), /installation was interrupted/);
        assert.deepEqual([lease.disposed, lease.root, root.destroyed, root.hasListener("removed"),
            stage.children.includes(root), scheduler.activeCount], [true, null, true, false, false, 0]);
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("install-after-reentrant frame disposal retains authority when reconciliation clear fails", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new CountingNode();
    let lease: FlashDisplayRootLease<CountingNode>;
    try {
        install(stage, scheduler);
        lease = FlashDisplayRootBoundary.claim<CountingNode>(stage, () => undefined);
        scheduler.beforeFrameRegistration = () => {
            lease.dispose();
            assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/,
                "authority release is deferred while frameLoop can still install");
            scheduler.clearThrowsBeforeMutation = true;
            scheduler.clearError = new Error("fixture reconciliation clear failure");
        };
        assert.throws(() => lease.attach(root), /frame registration was interrupted/);
        assert.deepEqual([lease.disposed, lease.attached, lease.root, root.destroyed,
            scheduler.activeCount], [false, false, root, true, 1]);
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/,
            "the old lease must retain Stage authority while installed-after-cleanup work is possible");
        const retained = scheduler.latest();
        scheduler.fire(retained);

        scheduler.beforeFrameRegistration = null;
        scheduler.clearError = null;
        lease.dispose();
        assert.deepEqual([lease.disposed, lease.root, scheduler.activeCount], [true, null, 0]);
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("install-after-reentrant listener disposal retains authority when reconciliation off fails", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new CountingNode();
    const originalOn = root.on.bind(root);
    const originalOff = root.off.bind(root);
    let failBeforeRemoval = false;
    let lease: FlashDisplayRootLease<CountingNode>;
    root.off = ((type: string, caller: unknown, listener?: Function) => {
        if (failBeforeRemoval) throw new Error("fixture reconciliation off failure");
        return originalOff(type, caller, listener!);
    }) as typeof root.off;
    root.on = ((type: string, caller: unknown, listener?: Function, args?: unknown[]) => {
        lease.dispose();
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/,
            "authority release is deferred while on can still install");
        failBeforeRemoval = true;
        return originalOn(type, caller, listener!, args);
    }) as typeof root.on;
    try {
        install(stage, scheduler);
        lease = FlashDisplayRootBoundary.claim<CountingNode>(stage, () => undefined);
        assert.throws(() => lease.attach(root), /fixture reconciliation off failure/);
        assert.deepEqual([lease.disposed, lease.attached, lease.root, root.destroyed,
            root.hasListener("removed"), scheduler.activeCount], [false, false, root, true, true, 0]);
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/,
            "the old lease must retain Stage authority while listener cleanup is indeterminate");

        failBeforeRemoval = false;
        lease.dispose();
        assert.deepEqual([lease.disposed, lease.root, root.hasListener("removed")], [true, null, false]);
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("throw-after-install frame registration reacquires cleanup after reentrant disposal", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new CountingNode();
    let lease: FlashDisplayRootLease<CountingNode>;
    try {
        install(stage, scheduler);
        lease = FlashDisplayRootBoundary.claim<CountingNode>(stage, () => undefined);
        scheduler.registerError = new Error("fixture frame-loop post-install failure");
        scheduler.beforeFrameRegistration = () => {
            lease.dispose();
            assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/);
            scheduler.clearThrowsBeforeMutation = true;
            scheduler.clearError = new Error("fixture exception reconciliation clear failure");
        };
        assert.throws(() => lease.attach(root), /fixture frame-loop post-install failure/);
        assert.deepEqual([lease.disposed, lease.root, root.destroyed, scheduler.activeCount],
            [false, root, true, 1]);
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/);
        scheduler.fire(scheduler.latest());

        scheduler.beforeFrameRegistration = null;
        scheduler.registerError = null;
        scheduler.clearError = null;
        lease.dispose();
        assert.deepEqual([lease.disposed, lease.root, scheduler.activeCount], [true, null, 0]);
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("throw-after-install removal listener reacquires cleanup after reentrant disposal", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new CountingNode();
    const originalOn = root.on.bind(root);
    const originalOff = root.off.bind(root);
    let failBeforeRemoval = false;
    let lease: FlashDisplayRootLease<CountingNode>;
    root.off = ((type: string, caller: unknown, listener?: Function) => {
        if (failBeforeRemoval) throw new Error("fixture exception reconciliation off failure");
        return originalOff(type, caller, listener!);
    }) as typeof root.off;
    root.on = ((type: string, caller: unknown, listener?: Function, args?: unknown[]) => {
        lease.dispose();
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/);
        failBeforeRemoval = true;
        originalOn(type, caller, listener!, args);
        throw new Error("fixture on post-install failure");
    }) as typeof root.on;
    try {
        install(stage, scheduler);
        lease = FlashDisplayRootBoundary.claim<CountingNode>(stage, () => undefined);
        assert.throws(() => lease.attach(root), /fixture on post-install failure/);
        assert.deepEqual([lease.disposed, lease.root, root.destroyed, root.hasListener("removed")],
            [false, root, true, true]);
        assert.throws(() => FlashDisplayRootBoundary.claim(stage, () => undefined), /already has/);

        failBeforeRemoval = false;
        lease.dispose();
        assert.deepEqual([lease.disposed, lease.root, root.hasListener("removed")], [true, null, false]);
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("frame callbacks propagate listener errors and may reentrantly dispose exactly once", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const firstRoot = new CountingNode();
    const expected = new Error("fixture frame listener failure");
    try {
        install(stage, scheduler);
        let throwingCalls = 0;
        const throwing = FlashDisplayRootBoundary.claim<CountingNode>(stage, () => {
            throwingCalls++;
            throw expected;
        });
        throwing.attach(firstRoot);
        assert.throws(() => scheduler.tick(), error => error === expected);
        assert.deepEqual([throwingCalls, throwing.attached, scheduler.activeCount], [1, true, 1]);
        throwing.dispose();

        const root = new CountingNode();
        let lease: FlashDisplayRootLease<CountingNode>;
        let calls = 0;
        lease = FlashDisplayRootBoundary.claim<CountingNode>(stage, () => {
            calls++;
            lease.dispose();
        });
        lease.attach(root);
        scheduler.tick();
        scheduler.tick();
        lease.dispose();
        assert.deepEqual([calls, lease.disposed, lease.root, root.destroyCalls, scheduler.activeCount],
            [1, true, null, 1, 0]);
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("reentrant detach and disposal during insertion never publish partial attachment", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    try {
        const firstStage = new Stage();
        const firstScheduler = new FakeScheduler();
        install(firstStage, firstScheduler);
        const detachedRoot = new LayaNode();
        const detachedLease = FlashDisplayRootBoundary.claim<LayaNode>(firstStage, () => undefined);
        detachedRoot.on("added", () => detachedLease.detach());
        assert.throws(() => detachedLease.attach(detachedRoot), /attachment was interrupted/);
        assert.deepEqual([detachedLease.root, detachedLease.attached, detachedRoot.parent,
            firstStage.numChildren, firstScheduler.activeCount], [null, false, null, 0, 0]);
        detachedLease.dispose();

        const secondStage = new Stage();
        const secondScheduler = new FakeScheduler();
        install(secondStage, secondScheduler);
        const destroyedRoot = new CountingNode();
        const disposedLease = FlashDisplayRootBoundary.claim<CountingNode>(secondStage, () => undefined);
        destroyedRoot.on("added", () => disposedLease.dispose());
        assert.throws(() => disposedLease.attach(destroyedRoot), /attachment was interrupted/);
        disposedLease.dispose();
        assert.deepEqual([disposedLease.disposed, disposedLease.root, destroyedRoot.destroyed,
            destroyedRoot.destroyCalls, secondScheduler.activeCount], [true, null, true, 1, 0]);
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("failed frame registration rolls attachment back and releases the first root claim", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const firstStage = new Stage();
    const broken = new FakeScheduler();
    const root = new LayaNode();
    try {
        install(firstStage, broken);
        broken.registerError = new Error("fixture frame-loop failure");
        const firstLease = FlashDisplayRootBoundary.claim<LayaNode>(firstStage, () => undefined);
        assert.throws(() => firstLease.attach(root), /fixture frame-loop failure/);
        assert.deepEqual([firstLease.root, root.parent, firstStage.numChildren, broken.activeCount],
            [null, null, 0, 0]);
        firstLease.dispose();

        const nextStage = new Stage();
        const nextScheduler = new FakeScheduler();
        install(nextStage, nextScheduler);
        const nextLease = FlashDisplayRootBoundary.claim<LayaNode>(nextStage, () => undefined, {
            destroyRootOnDispose: false
        });
        assert.equal(nextLease.attach(root), root);
        nextLease.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("scheduler replacement and Stage replacement cannot revive retained generation callbacks", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const first = new FakeScheduler();
    const second = new FakeScheduler();
    const root = new LayaNode();
    let frames = 0;
    try {
        install(stage, first);
        const lease = FlashDisplayRootBoundary.claim<LayaNode>(stage, () => frames++, {
            destroyRootOnDispose: false
        });
        lease.attach(root);
        const registration = first.latest();
        ILaya.timer = second as unknown as LayaTimer;
        ILaya.stage = new Stage();
        first.fire(registration);
        assert.deepEqual([frames, first.activeCount, second.clearCalls, lease.attached], [0, 0, 0, false]);
        first.fire(registration);
        assert.equal(frames, 0);
        lease.dispose();
        assert.equal(root.parent, null);
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});

test("retryable disposal preserves exclusive ownership until native cleanup succeeds", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const stage = new Stage();
    const scheduler = new FakeScheduler();
    const root = new RetryDestroyNode();
    try {
        install(stage, scheduler);
        const lease = FlashDisplayRootBoundary.claim<RetryDestroyNode>(stage, () => undefined);
        lease.attach(root);
        root.beforeDestroy = () => lease.dispose();
        assert.throws(() => lease.dispose(), /fixture destroy failure/);
        assert.deepEqual([lease.root, lease.disposed, lease.attached, root.destroyed, scheduler.activeCount],
            [root, false, false, false, 0]);
        assert.throws(() => lease.detach(), /disposal is pending/);
        root.failDestruction = false;
        lease.dispose();
        lease.dispose();
        assert.deepEqual([lease.root, lease.disposed, root.destroyed, root.destroyCalls],
            [null, true, true, 2]);
        const successor = FlashDisplayRootBoundary.claim(stage, () => undefined);
        successor.dispose();
    } finally {
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
    }
});
