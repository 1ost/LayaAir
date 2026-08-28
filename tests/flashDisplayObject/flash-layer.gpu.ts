import { Laya } from "../../src/layaAir/Laya";
import { Sprite } from "../../src/layaAir/laya/display/Sprite";
import "../../src/layaAir/laya/platform/BrowserAdapter";
import "../../src/layaAir/laya/platform/FileSystemAdapter";
import "../../src/layaAir/laya/platform/FontAdapter";
import "../../src/layaAir/laya/platform/MediaAdapter";
import "../../src/layaAir/laya/platform/StorageAdapter";
import "../../src/layaAir/laya/platform/TextInputAdapter";
import "../../src/layaAir/laya/device/WebDeviceAdapter";
import "../../src/layaAir/laya/RenderDriver/RenderModuleData/WebModuleData/WebUnitRenderModuleDataFactory";
import "../../src/layaAir/laya/RenderDriver/WebGLDriver/RenderDevice/WebGLRenderDeviceFactory";
import "../../src/layaAir/laya/RenderDriver/WebGLDriver/2DRenderPass/WebGLRender2DProcess";

void main().then(result => write({ ok: true, result }), error => write({ ok: false, error: String(error?.stack || error) }));

async function main() {
    await Laya.init(64, 64);
    Laya.stage.bgColor = "#ffffff";
    const normal = await render("normal");
    const layer = await render("layer");
    if (equal(normal, layer)) throw new Error(`layer isolation collapsed to normal: ${normal}`);
    // Normal applies parent alpha to each overlapping child. Layer first resolves
    // the opaque subtree, then applies parent alpha once, so the top blue child
    // cannot leak the lower red child through its overlap.
    if (!(layer[1] > normal[1] + 40 && Math.abs(layer[0] - layer[1]) < 3 && layer[2] > 245))
        throw new Error(`unexpected isolation pixels: normal=${normal}, layer=${layer}`);
    return { renderer: "WebGL", normal, layer };
}

async function render(mode: "normal" | "layer"): Promise<number[]> {
    Laya.stage.removeChildren();
    const group = new Sprite();
    group.alpha = 0.5;
    group.blendMode = mode;
    const red = new Sprite(); red.graphics.drawRect(8, 8, 40, 40, "#ff0000");
    const blue = new Sprite(); blue.graphics.drawRect(24, 8, 32, 40, "#0000ff");
    group.addChild(red); group.addChild(blue); Laya.stage.addChild(group);
    Laya.stage.render(performance.now());
    await new Promise(requestAnimationFrame);
    Laya.stage.render(performance.now());
    const gl = document.querySelector("canvas")!.getContext("webgl2", { preserveDrawingBuffer: true })
        || document.querySelector("canvas")!.getContext("webgl", { preserveDrawingBuffer: true })!;
    gl.finish(); const pixel = new Uint8Array(4); gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
}
function equal(a: number[], b: number[]) { return a.every((v, i) => v === b[i]); }
function write(payload: unknown) { const pre = document.createElement("pre"); pre.id = "flash-layer-gpu-result"; pre.textContent = JSON.stringify(payload); document.body.appendChild(pre); }
