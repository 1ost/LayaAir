import { ILaya } from "../../src/layaAir/ILaya";
import { FlashDisplayRootBoundary } from "../../src/layaAir/flash/display/FlashDisplayRootBoundary";
import { FlashStageBoundary } from "../../src/layaAir/flash/display/FlashStageBoundary";
import { Sprite } from "../../src/layaAir/flash/display/Sprite";
import { Stage as FlashStage } from "../../src/layaAir/flash/display/Stage";
import { Event } from "../../src/layaAir/flash/events/Event";
import { Stage as LayaStage } from "../../src/layaAir/laya/display/Stage";
import { Event as LayaEvent } from "../../src/layaAir/laya/events/Event";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import { Timer } from "../../src/layaAir/laya/utils/Timer";

function publish(result: "passed" | "failed", detail: string): void {
    document.body.dataset.result = result;
    document.body.textContent = detail;
}

try {
    LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
    LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
    (PAL as any).browser ??= { on: (): void => undefined };
    (PAL as any).textInput ??= { target: null };

    const stage = new LayaStage();
    const timer = new Timer(false);
    ILaya.stage = stage;
    ILaya.timer = timer;
    Browser.mainCanvas = { source: document.createElement("canvas") } as any;
    FlashStageBoundary.configure(stage, {
        align: "TL", scaleMode: "noScale", quality: "high", showDefaultContextMenu: false,
        loaderParameters: FlashStageBoundary.parseLoaderParameters("?browser=chromium"),
    });
    const firstViewport = FlashStageBoundary.claimViewport(stage, { width: 1250, height: 650 });
    const sourceStage = FlashStage.fromNative(stage);
    firstViewport.dispose();
    const viewport = FlashStageBoundary.claimViewport(stage, { width: 1024, height: 576 });
    firstViewport.dispose();
    viewport.resizeViewport(1250, 650);
    if (firstViewport.disposed !== true || viewport.disposed !== false
        || sourceStage.stageWidth !== 1250 || sourceStage.stageHeight !== 650)
        throw new Error("actual Laya Stage did not fence stale viewport generations");
    const root = new Sprite();
    const identities: Array<[unknown, unknown]> = [];
    const observe = (event: Event): void => { identities.push([event.target, event.currentTarget]); };

    sourceStage.addEventListener(Event.CHANGE, observe);
    sourceStage.dispatchEvent(new Event(Event.CHANGE));
    sourceStage.removeEventListener(Event.CHANGE, observe);
    sourceStage.addEventListener(Event.RESIZE, observe);
    stage.event(LayaEvent.RESIZE, new LayaEvent().setTo(LayaEvent.RESIZE, stage, stage));
    sourceStage.removeEventListener(Event.RESIZE, observe);
    sourceStage.addEventListener(Event.ENTER_FRAME, observe);
    let frames = 0;
    const lease = FlashDisplayRootBoundary.claim<Sprite>(stage, () => frames++, {
        destroyRootOnDispose: false,
    });
    const leaseKeys = Reflect.ownKeys(lease);
    lease.attach(root);
    timer._update(performance.now() + 17);
    sourceStage.removeEventListener(Event.ENTER_FRAME, observe);
    if (frames !== 1 || identities.length !== 3
        || identities.some(([target, currentTarget]) => target !== sourceStage || currentTarget !== sourceStage
            || target === stage || currentTarget === stage)
        || !Object.is(root.parent, sourceStage) || !lease.attached || !Object.isFrozen(lease)
        || JSON.stringify(Reflect.ownKeys(lease).map(String)) !== JSON.stringify(leaseKeys.map(String)))
        throw new Error("actual Laya producers did not preserve public Stage and frozen lease identity");
    let disposedEvents = 0;
    sourceStage.addEventListener(Event.RESIZE, () => disposedEvents++);
    FlashStageBoundary.dispose(stage);
    stage.event(LayaEvent.RESIZE, new LayaEvent().setTo(LayaEvent.RESIZE, stage, stage));
    lease.dispose();
    timer._update(performance.now() + 34);
    if (frames !== 1 || disposedEvents !== 0 || root.parent !== null || !lease.disposed
        || !viewport.disposed)
        throw new Error("actual Laya cleanup did not fence disposed Stage and display-root listeners");
    const remount = FlashStageBoundary.claimViewport(stage, { width: 800, height: 600 });
    firstViewport.dispose();
    if (FlashStage.fromNative(stage) !== sourceStage || Number(sourceStage.stageWidth) !== 800
        || Number(sourceStage.stageHeight) !== 600 || remount.disposed)
        throw new Error("actual Laya Stage did not allow a same-Stage viewport remount");
    remount.dispose();
    publish("passed", "Flash Stage identity/display-root Chromium gate passed");
} catch (error) {
    publish("failed", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
}
