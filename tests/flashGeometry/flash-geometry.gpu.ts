import { Config } from "../../src/layaAir/Config";
import { Laya } from "../../src/layaAir/Laya";
import { ColorTransform } from "../../src/layaAir/flash/geom/ColorTransform";
import { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject";
import { ColorMatrixFilter } from "../../src/layaAir/flash/filters/ColorMatrixFilter";
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

type Pixel = readonly [number, number, number, number];

declare global {
    interface Window { __flashGeometryGpu?: { ready: boolean; result?: unknown; error?: string } }
}

window.__flashGeometryGpu = { ready: false };
void main().then(result => {
    window.__flashGeometryGpu = { ready: true, result };
    writeResult({ ok: true, result });
}, error => {
    const message = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
    window.__flashGeometryGpu = { ready: true, error: message };
    writeResult({ ok: false, error: message });
});

async function main(): Promise<unknown> {
    Config.isAlpha = true;
    Config.premultipliedAlpha = true;
    Config.preserveDrawingBuffer = true;
    await Laya.init(64, 64);

    const alphaTransform = await render((_parent, child) => {
        child.transform.colorTransform = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 64);
    });
    expectAlpha(alphaTransform, 192, "alpha multiplier plus offset");

    const hierarchy = await render((parent, child) => {
        parent.transform.colorTransform = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 32);
        child.transform.colorTransform = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 64);
    });
    expectAlpha(hierarchy, 128, "hierarchical alpha transform");

    const transformBeforeFilter = await render((_parent, child) => {
        child.filters = [alphaHalfFilter()];
        child.transform.colorTransform = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 64);
    });
    expectAlpha(transformBeforeFilter, 96, "color transform before user filters");

    const reset = await render((_parent, child) => {
        child.filters = [alphaHalfFilter()];
        child.transform.colorTransform = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 64);
        child.transform.colorTransform = new ColorTransform();
        if (child.filters.length !== 1) throw new Error("identity reset removed the user filter");
    });
    expectAlpha(reset, 128, "identity reset preserving user filter");

    const directAlpha = await render((_parent, child) => { child.alpha = 0.5; });
    expectAlpha(directAlpha, 128, "direct alpha");

    const directAlphaWithOffset = await render((_parent, child) => {
        child.transform.colorTransform = new ColorTransform(1, 1, 1, 1, 0, 0, 0, 64);
        child.alpha = 0.25;
        if (child.transform.colorTransform.alphaMultiplier !== 0.25)
            throw new Error("direct alpha did not update the public ColorTransform state");
    });
    expectAlpha(directAlphaWithOffset, 128, "direct alpha plus retained offset");

    const zeroMultiplier = await render((_parent, child) => {
        child.transform.colorTransform = new ColorTransform(1, 1, 1, 0, 0, 0, 0, 128);
    });
    expectAlpha(zeroMultiplier, 128, "zero multiplier with positive offset");

    return {
        renderer: document.querySelector("canvas")?.getContext("webgl2") ? "WebGL" : "unknown",
        pixels: { alphaTransform, hierarchy, transformBeforeFilter, reset, directAlpha, directAlphaWithOffset, zeroMultiplier },
    };
}

function alphaHalfFilter(): ColorMatrixFilter {
    return new ColorMatrixFilter([
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        0, 0, 1, 0, 0,
        0, 0, 0, 0.5, 0,
    ]);
}

async function render(configure: (parent: DisplayObject, child: DisplayObject) => void): Promise<Pixel> {
    const parent = new DisplayObject();
    const child = new DisplayObject();
    child.graphics.drawRect(24, 24, 16, 16, "#ffffff");
    parent.addChild(child);
    configure(parent, child);
    Laya.stage.addChild(parent);
    Laya.stage.render(performance.now());
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2", { premultipliedAlpha: true }) || canvas?.getContext("webgl", { premultipliedAlpha: true });
    if (!gl) throw new Error("Laya stage WebGL context was not found");
    gl.finish();
    const pixels = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let result: Pixel = [0, 0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) {
        const candidate: Pixel = [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
        if (candidate[3] > result[3]) result = candidate;
    }
    parent.destroy(true);
    Laya.stage.render(performance.now());
    return result;
}

function expectAlpha(pixel: Pixel, expected: number, label: string): void {
    if (Math.abs(pixel[3] - expected) > 3)
        throw new Error(`${label}: expected alpha ${expected} +/- 3, received ${pixel.join(",")}`);
}

function writeResult(value: unknown): void {
    const node = document.createElement("pre");
    node.id = "flash-geometry-gpu-result";
    node.textContent = JSON.stringify(value);
    document.body.replaceChildren(node);
}
