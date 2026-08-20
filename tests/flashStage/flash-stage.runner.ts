import assert from "node:assert/strict";
import test from "node:test";
import { Config } from "../../src/layaAir/Config";
import { ILaya } from "../../src/layaAir/ILaya";
import { Sprite } from "../../src/layaAir/flash/display/Sprite";
import { FlashDisplayRootBoundary } from "../../src/layaAir/flash/display/FlashDisplayRootBoundary";
import { FlashStageBoundary } from "../../src/layaAir/flash/display/FlashStageBoundary";
import { Stage, isFlashStage } from "../../src/layaAir/flash/display/Stage";
import { Event } from "../../src/layaAir/flash/events/Event";
import { Node as LayaNode } from "../../src/layaAir/laya/display/Node";
import { Stage as LayaStage } from "../../src/layaAir/laya/display/Stage";
import { Event as LayaEvent } from "../../src/layaAir/laya/events/Event";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { Render } from "../../src/layaAir/laya/renders/Render";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import { Timer as LayaTimer } from "../../src/layaAir/laya/utils/Timer";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
(PAL as any).browser ??= { on: (): void => undefined };
(PAL as any).textInput ??= { target: null };

interface FrameRegistration { caller: unknown; method: Function; args: unknown[]; active: boolean; }

class FrameScheduler {
    readonly registrations: FrameRegistration[] = [];

    frameLoop(_delay: number, caller: unknown, method: Function, args: unknown[] = []): void {
        this.registrations.push({ caller, method, args: [...args], active: true });
    }

    clear(caller: unknown, method: Function): void {
        for (const registration of this.registrations)
            if (registration.caller === caller && registration.method === method) registration.active = false;
    }

    tick(): void {
        for (const registration of this.registrations.slice())
            if (registration.active) Reflect.apply(registration.method, registration.caller, registration.args);
    }

    get activeCount(): number { return this.registrations.filter(value => value.active).length; }
}

function install(stage: LayaStage, scheduler: FrameScheduler): void {
    ILaya.stage = stage;
    ILaya.timer = scheduler as unknown as LayaTimer;
    Browser.mainCanvas = { source: { oncontextmenu: null } } as any;
}

function bootstrap(stage: LayaStage, quality: "high" | "best" = "high",
    search = "", width = 1250, height = 650): { sourceStage: Stage, viewportOwner: ReturnType<typeof FlashStageBoundary.claimViewport> } {
    FlashStageBoundary.configure(stage, {
        align: "TL", scaleMode: "noScale", quality, showDefaultContextMenu: false,
        loaderParameters: FlashStageBoundary.parseLoaderParameters(search),
    });
    const viewportOwner = FlashStageBoundary.claimViewport(stage, { width, height });
    return { sourceStage: Stage.fromNative(stage), viewportOwner };
}

test("Stage bootstrap mints one stable source view without modifying the native Stage", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const previousCanvas = Browser.mainCanvas;
    const previousFPS = Config.FPS;
    const previousInterval = Render.frameInterval;
    const nativeStage = new LayaStage();
    const scheduler = new FrameScheduler();
    try {
        install(nativeStage, scheduler);
        const result = bootstrap(nativeStage, "best", "?locale=en_US&desktopChromeHeight=32");
        const sourceStage = result.sourceStage;
        const parameters = sourceStage.loaderInfo.parameters;

        assert.equal(Stage.fromNative(nativeStage), sourceStage, "one native Stage has one stable source view");
        assert.equal(isFlashStage(sourceStage), true);
        assert.equal(Object.isFrozen(sourceStage), true);
        assert.equal(isFlashStage(nativeStage), false, "the view does not inject source identity into Laya Stage");
        assert.equal(Object.getPrototypeOf(nativeStage), LayaStage.prototype,
            "bootstrap never replaces or decorates the native Stage prototype");
        assert.deepEqual([
            sourceStage.align,
            sourceStage.scaleMode,
            sourceStage.quality,
            sourceStage.showDefaultContextMenu,
            sourceStage.stageWidth,
            sourceStage.stageHeight,
            sourceStage.parent,
            sourceStage.root,
            sourceStage.stage,
        ], ["TL", "noScale", "best", false, 1250, 650, null, sourceStage, sourceStage]);
        assert.equal(sourceStage.loaderInfo, sourceStage.loaderInfo, "Stage LoaderInfo identity is stable");
        assert.equal(sourceStage.loaderInfo.parameters, parameters);
        assert.equal(Object.isFrozen(sourceStage.loaderInfo), true);
        assert.equal((Browser.mainCanvas.source as any).oncontextmenu(), false);

        sourceStage.quality = "high";
        sourceStage.frameRate = 48;
        assert.deepEqual([sourceStage.quality, sourceStage.frameRate, Config.FPS, Render.frameInterval],
            ["high", 48, 48, 1000 / 48]);
        assert.equal(nativeStage.frameRate, "fast", "numeric source FPS does not overwrite Laya throttle mode");
        for (const [property, value] of [["align", "C"], ["scaleMode", "showAll"],
            ["quality", "low"], ["showDefaultContextMenu", true]] as const)
            assert.throws(() => { (sourceStage as any)[property] = value; }, /supports only/);
        assert.deepEqual([sourceStage.align, sourceStage.scaleMode, sourceStage.quality,
            sourceStage.showDefaultContextMenu], ["TL", "noScale", "high", false],
            "rejected source settings cannot publish partial Stage policy");

        let resizeCount = 0;
        sourceStage.addEventListener(Event.RESIZE, () => {
            resizeCount++;
            assert.deepEqual([sourceStage.stageWidth, sourceStage.stageHeight], [1366, 768]);
        });
        assert.equal(sourceStage.hasEventListener(Event.RESIZE), true);
        result.viewportOwner.resizeViewport(1366, 768);
        assert.equal(resizeCount, 1);
    } finally {
        FlashStageBoundary.dispose(nativeStage);
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
        Browser.mainCanvas = previousCanvas;
        Config.FPS = previousFPS;
        Render.frameInterval = previousInterval;
    }
});

test("viewport leases roll back failed mounts and fence stale generations on same-Stage remount", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const previousCanvas = Browser.mainCanvas;
    const nativeStage = new LayaStage();
    const scheduler = new FrameScheduler();
    try {
        install(nativeStage, scheduler);
        const configured = FlashStageBoundary.configure(nativeStage, {
            align: "TL", scaleMode: "noScale", quality: "best", showDefaultContextMenu: false,
            loaderParameters: FlashStageBoundary.parseLoaderParameters("?mount=first"),
        });
        const sourceStage = Stage.fromNative(nativeStage);
        let failedMountLease: ReturnType<typeof FlashStageBoundary.claimViewport> | undefined;
        const failure = new Error("fixture later mount failure");
        assert.throws(() => {
            failedMountLease = FlashStageBoundary.claimViewport(nativeStage, { width: 1250, height: 650 });
            throw failure;
        }, error => error === failure);
        failedMountLease!.dispose();
        assert.equal(failedMountLease!.disposed, true);
        assert.equal(Object.isFrozen(failedMountLease), true);
        assert.throws(() => failedMountLease!.resizeViewport(1, 1), /exact engine-issued owner/);
        assert.throws(() => failedMountLease!.stageWidth, /exact engine-issued owner/);
        assert.throws(() => FlashStageBoundary.getWidth(nativeStage), /has not been claimed/);

        const successor = FlashStageBoundary.claimViewport(nativeStage, { width: 1024, height: 576 });
        failedMountLease!.dispose();
        assert.deepEqual([successor.disposed, successor.stageWidth, successor.stageHeight],
            [false, 1024, 576], "stale release cannot affect the successor generation");
        successor.resizeViewport(1366, 768);
        assert.deepEqual([sourceStage.stageWidth, sourceStage.stageHeight], [1366, 768]);
        const disposeMethod = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(successor), "dispose")?.value;
        assert.throws(() => Reflect.apply(disposeMethod, {}, []), /exact engine-issued owner/);

        FlashStageBoundary.dispose(nativeStage);
        assert.equal(successor.disposed, true, "Stage-boundary disposal releases current viewport ownership");
        const remount = FlashStageBoundary.claimViewport(nativeStage, { width: 800, height: 600 });
        assert.deepEqual([Stage.fromNative(nativeStage), FlashStageBoundary.getBootstrap(nativeStage),
            remount.stageWidth, remount.stageHeight], [sourceStage, configured, 800, 600],
        "same-Stage remount preserves public identity and bootstrap configuration");
        successor.dispose();
        assert.equal(remount.disposed, false, "a stale post-disposal lease cannot release the remount");
        remount.dispose();
        remount.dispose();
        assert.equal(remount.disposed, true);
    } finally {
        FlashStageBoundary.dispose(nativeStage);
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
        Browser.mainCanvas = previousCanvas;
    }
});

test("Stage child operations retain Laya attachment and Flash lifecycle semantics", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const previousCanvas = Browser.mainCanvas;
    const nativeStage = new LayaStage();
    const scheduler = new FrameScheduler();
    try {
        install(nativeStage, scheduler);
        const sourceStage = bootstrap(nativeStage, "high", "", 800, 600).sourceStage;
        const child = new Sprite();
        child.name = "document";
        const lifecycle: string[] = [];
        child.addEventListener(Event.ADDED_TO_STAGE, () => lifecycle.push("added"));
        child.addEventListener(Event.REMOVED_FROM_STAGE, () => lifecycle.push("removed"));

        assert.equal(Stage.forDisplayObject(child), null);
        assert.equal(sourceStage.addChild(child), child);
        assert.deepEqual([child.parent, FlashStageBoundary.stageOf(child), Stage.forDisplayObject(child)],
            [nativeStage, nativeStage, sourceStage]);
        assert.deepEqual([sourceStage.numChildren, sourceStage.getChildAt(0),
            sourceStage.getChildByName("document"), sourceStage.contains(child)], [1, child, child, true]);
        assert.deepEqual(lifecycle, ["added"]);

        assert.equal(sourceStage.removeChild(child), child);
        assert.deepEqual([child.parent, Stage.forDisplayObject(child), sourceStage.numChildren], [null, null, 0]);
        assert.deepEqual(lifecycle, ["added", "removed"]);

        const raw = new LayaNode();
        assert.throws(() => (sourceStage as any).addChild(raw), /canonical DisplayObject/);
        nativeStage.addChild(raw);
        assert.throws(() => sourceStage.getChildAt(0), /canonical DisplayObject/,
            "source access never leaks an unadmitted native child");
        nativeStage.removeChild(raw);
    } finally {
        FlashStageBoundary.dispose(nativeStage);
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
        Browser.mainCanvas = previousCanvas;
    }
});

test("Stage events expose only the stable public facade for programmatic and native producers", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const previousCanvas = Browser.mainCanvas;
    const nativeStage = new LayaStage();
    const scheduler = new FrameScheduler();
    try {
        install(nativeStage, scheduler);
        const sourceStage = bootstrap(nativeStage).sourceStage;
        const identities: Array<[unknown, unknown]> = [];
        const observe = (event: Event): void => {
            identities.push([event.target, event.currentTarget]);
            assert.equal(event.target, sourceStage);
            assert.equal(event.currentTarget, sourceStage);
            assert.notEqual(event.target, nativeStage);
            assert.notEqual(event.currentTarget, nativeStage);
        };

        sourceStage.addEventListener(Event.CHANGE, observe);
        sourceStage.dispatchEvent(new Event(Event.CHANGE));
        sourceStage.removeEventListener(Event.CHANGE, observe);
        sourceStage.dispatchEvent(new Event(Event.CHANGE));
        assert.equal(identities.length, 1, "removed programmatic listener stays detached");

        sourceStage.addEventListener(Event.RESIZE, observe);
        nativeStage.event(LayaEvent.RESIZE,
            new LayaEvent().setTo(LayaEvent.RESIZE, nativeStage, nativeStage));
        sourceStage.removeEventListener(Event.RESIZE, observe);

        sourceStage.addEventListener(Event.ENTER_FRAME, observe);
        assert.equal(scheduler.activeCount, 1);
        scheduler.tick();
        sourceStage.removeEventListener(Event.ENTER_FRAME, observe);
        assert.equal(scheduler.activeCount, 0, "enterFrame removal clears the native scheduler subscription");

        let disposedCalls = 0;
        sourceStage.addEventListener(Event.RESIZE, () => disposedCalls++);
        FlashStageBoundary.dispose(nativeStage);
        nativeStage.event(LayaEvent.RESIZE,
            new LayaEvent().setTo(LayaEvent.RESIZE, nativeStage, nativeStage));
        scheduler.tick();
        assert.deepEqual([identities.length, disposedCalls, sourceStage.hasEventListener(Event.RESIZE)],
            [3, 0, false], "boundary disposal detaches native and timer producers");
    } finally {
        FlashStageBoundary.dispose(nativeStage);
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
        Browser.mainCanvas = previousCanvas;
    }
});

test("Stage view composes with the display-root frame lease and invalidates on replacement", () => {
    const previousStage = ILaya.stage;
    const previousTimer = ILaya.timer;
    const previousCanvas = Browser.mainCanvas;
    const nativeStage = new LayaStage();
    const scheduler = new FrameScheduler();
    try {
        install(nativeStage, scheduler);
        const sourceStage = bootstrap(nativeStage, "best", "locale=en_US").sourceStage;
        const root = new Sprite();
        let frames = 0;
        const lease = FlashDisplayRootBoundary.claim<Sprite>(nativeStage, current => {
            frames++;
            assert.equal(current, root);
            assert.equal(Stage.forDisplayObject(current), sourceStage);
        }, { destroyRootOnDispose: false });
        lease.attach(root);
        scheduler.tick();
        assert.deepEqual([frames, lease.attached, scheduler.activeCount], [1, true, 1]);
        lease.dispose();
        scheduler.tick();
        assert.deepEqual([frames, root.parent, scheduler.activeCount], [1, null, 0]);

        ILaya.stage = new LayaStage();
        assert.throws(() => sourceStage.stageWidth, /live canonical Laya Stage/);
        assert.throws(() => sourceStage.addChild(new Sprite()), /live canonical Laya Stage/);
    } finally {
        ILaya.stage = nativeStage;
        FlashStageBoundary.dispose(nativeStage);
        ILaya.stage = previousStage;
        ILaya.timer = previousTimer;
        Browser.mainCanvas = previousCanvas;
    }
});

test("Stage constructor and borrowed methods reject forged receivers before mutation", () => {
    const previousStage = ILaya.stage;
    const previousCanvas = Browser.mainCanvas;
    const nativeStage = new LayaStage();
    try {
        ILaya.stage = nativeStage;
        Browser.mainCanvas = { source: { oncontextmenu: null } } as any;
        assert.throws(() => new (Stage as any)(Symbol("forged"), nativeStage), /created only/);
        const sourceStage = bootstrap(nativeStage, "high", "", 1, 1).sourceStage;
        const addChild = sourceStage.addChild;
        assert.throws(() => Reflect.apply(addChild, {}, [new Sprite()]), /engine-issued Stage view/);
        assert.equal(nativeStage.numChildren, 0);
    } finally {
        FlashStageBoundary.dispose(nativeStage);
        ILaya.stage = previousStage;
        Browser.mainCanvas = previousCanvas;
    }
});
