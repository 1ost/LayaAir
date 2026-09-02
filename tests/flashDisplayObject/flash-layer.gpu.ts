import { Laya } from "../../src/layaAir/Laya";
import { Sprite } from "../../src/layaAir/laya/display/Sprite";
import { Texture } from "../../src/layaAir/laya/resource/Texture";
import { Texture2D } from "../../src/layaAir/laya/resource/Texture2D";
import { Image } from "../../src/layaAir/laya/ui/Image";
import { MovieClip } from "../../src/layaAir/flash/display/MovieClip";
import { WebRender2DPass } from "../../src/layaAir/laya/RenderDriver/RenderModuleData/WebModuleData/2D/WebRender2DPass";
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
    assertForeignMaskPassIsCulled();
    Laya.stage.bgColor = "#ffffff";
    const normal = await render("normal");
    const layer = await render("layer");
    if (equal(normal, layer)) throw new Error(`layer isolation collapsed to normal: ${normal}`);
    // Normal applies parent alpha to each overlapping child. Layer first resolves
    // the opaque subtree, then applies parent alpha once, so the top blue child
    // cannot leak the lower red child through its overlap.
    if (!(layer[1] > normal[1] + 40 && Math.abs(layer[0] - layer[1]) < 3 && layer[2] > 245))
        throw new Error(`unexpected isolation pixels: normal=${normal}, layer=${layer}`);
    const emptyMask = await renderEmptyMaskedSprite();
    if (!(emptyMask.inside[0] > 245 && emptyMask.inside[1] < 10 && emptyMask.inside[2] < 10))
        throw new Error(`empty masked sprite erased an earlier sibling: ${JSON.stringify(emptyMask)}`);
    if (!equal(emptyMask.inside, emptyMask.outside))
        throw new Error(`empty masked sprite changed pixels inside its mask: ${JSON.stringify(emptyMask)}`);
    return { renderer: "WebGL", normal, layer, emptyMask };
}

function assertForeignMaskPassIsCulled(): void {
    const parentPass = new WebRender2DPass();
    const rootPass = new WebRender2DPass();
    const maskStruct = {
        enabled: true,
        globalAlpha: 1,
        _maskParentPass: parentPass,
        _handleInterData(): never {
            throw new Error("mask node leaked into a foreign render pass");
        },
    };
    rootPass.cullAndSort(null!, maskStruct as never);
    parentPass.destroy();
    rootPass.destroy();
}

async function renderEmptyMaskedSprite(): Promise<{ inside: number[]; outside: number[] }> {
    Laya.stage.removeChildren();
    const background = new Sprite();
    background.graphics.drawRect(0, 0, 64, 64, "#ff0000");
    background.zOrder = 2;
    const container = new Sprite();
    container.pos(24, 12);
    container.zOrder = 13;
    const mask = new Image();
    mask.source = new Texture(Texture2D.whiteTexture);
    mask.size(16, 40);
    mask.pos(-16, 8);
    mask.zOrder = 1;
    const empty = new MovieClip();
    empty.zOrder = 2;
    const assigned = (empty as unknown as {
        _assignHierarchyNodeReference(key: string, value: unknown): boolean;
    })._assignHierarchyNodeReference("mask", mask);
    if (!assigned) throw new Error("authored native mask reference was not assigned");
    container.addChild(mask);
    container.addChild(empty);
    Laya.stage.addChild(background);
    Laya.stage.addChild(container);
    Laya.stage.render(performance.now());
    await new Promise(requestAnimationFrame);
    Laya.stage.render(performance.now());
    const gl = document.querySelector("canvas")!.getContext("webgl2", { preserveDrawingBuffer: true })
        || document.querySelector("canvas")!.getContext("webgl", { preserveDrawingBuffer: true })!;
    gl.finish();
    return { inside: readPixel(gl, 12, 32), outside: readPixel(gl, 40, 32) };
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
function readPixel(gl: WebGLRenderingContext | WebGL2RenderingContext, x: number, y: number): number[] {
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
}
function write(payload: unknown) { const pre = document.createElement("pre"); pre.id = "flash-layer-gpu-result"; pre.textContent = JSON.stringify(payload); document.body.appendChild(pre); }
