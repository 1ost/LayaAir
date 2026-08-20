import { ILaya } from "../../src/layaAir/ILaya";
import { FlashDisplayRootBoundary } from "../../src/layaAir/flash/display/FlashDisplayRootBoundary";
import { Sprite } from "../../src/layaAir/flash/display/Sprite";
import { Stage } from "../../src/layaAir/laya/display/Stage";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
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

    const stage = new Stage();
    const timer = new Timer(false);
    ILaya.stage = stage;
    ILaya.timer = timer;
    const root = new Sprite();
    let frames = 0;
    const lease = FlashDisplayRootBoundary.claim<Sprite>(stage, () => frames++, {
        destroyRootOnDispose: false,
    });
    const leaseKeys = Reflect.ownKeys(lease);
    lease.attach(root);
    timer._update(performance.now() + 17);
    if (frames !== 1 || root.parent !== stage || !lease.attached || !Object.isFrozen(lease)
        || JSON.stringify(Reflect.ownKeys(lease).map(String)) !== JSON.stringify(leaseKeys.map(String)))
        throw new Error("actual Laya frame attachment did not preserve the frozen public lease");
    lease.dispose();
    timer._update(performance.now() + 34);
    if (frames !== 1 || root.parent !== null || !lease.disposed)
        throw new Error("actual Laya timer cleanup did not fence the disposed root");
    publish("passed", "Flash Stage/display-root Chromium scheduler gate passed");
} catch (error) {
    publish("failed", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
}
