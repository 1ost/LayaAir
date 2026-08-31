import { Laya } from "../../src/layaAir/Laya";
import { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject";
import { BitmapFilter } from "../../src/layaAir/flash/filters/BitmapFilter";
import { BlurFilter } from "../../src/layaAir/flash/filters/BlurFilter";
import { ColorMatrixFilter } from "../../src/layaAir/flash/filters/ColorMatrixFilter";
import { DropShadowFilter } from "../../src/layaAir/flash/filters/DropShadowFilter";
import { GlowFilter } from "../../src/layaAir/flash/filters/GlowFilter";
import { GradientBevelFilter } from "../../src/layaAir/flash/filters/GradientBevelFilter";
import { setDisplayObjectNativeFilters } from "../../src/layaAir/flash/geom/Transform";
import { createFlashAuthoredBevelFilter } from "../../src/layaAir/laya/display/effect2d/FlashBevelEffects";
import { Filter } from "../../src/layaAir/laya/filters/Filter";
import { PostProcess2D } from "../../src/layaAir/laya/display/PostProcess2D";
import { Sprite as LayaSprite } from "../../src/layaAir/laya/display/Sprite";
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
type Readback = { width: number; height: number; pixels: Uint8Array };

declare global {
    interface Window { __flashFilterGpu?: { ready: boolean; result?: unknown; error?: string } }
}

window.__flashFilterGpu = { ready: false };
const gpuLogs: string[] = [];
for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
        gpuLogs.push(`${level}: ${values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ")}`);
        original(...values);
    };
}
void main().then(result => {
    window.__flashFilterGpu = { ready: true, result };
    writeResult({ ok: true, result });
}, error => {
    const message = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
    window.__flashFilterGpu = { ready: true, error: message };
    writeResult({ ok: false, error: message });
});

async function main(): Promise<unknown> {
    await Laya.init(64, 64);
    Laya.stage.bgColor = "#000000";
    assertFilteredCompositeVertexIsolation();

    const baseline = await render(null, 0xffffff);
    assert(alphaMass(baseline) > 1000, `unfiltered Laya GPU baseline was empty: ${alphaMass(baseline)}`);

    const overlay = await renderOverlayStage();
    assertPixelNear("Flash overlay over low/high backdrop", pixelAt(overlay, 32, 56), [96, 161, 255, 255], 1);
    assertPixelNear("Flash overlay over high/low backdrop", pixelAt(overlay, 32, 8), [224, 32, 64, 255], 1);

    const blurHorizontal = await render(new BlurFilter(16, 2, 1), 0xffffff);
    const blurVertical = await render(new BlurFilter(2, 16, 1), 0xffffff);
    const horizontalBounds = alphaBounds(blurHorizontal);
    const verticalBounds = alphaBounds(blurVertical);
    assert(horizontalBounds.width > horizontalBounds.height + 4, `horizontal anisotropy collapsed: ${JSON.stringify(horizontalBounds)} logs=${gpuLogs.join(" | ")}`);
    assert(verticalBounds.height > verticalBounds.width + 4, `vertical anisotropy collapsed: ${JSON.stringify(verticalBounds)}`);

    const blurQualityOne = await render(new BlurFilter(12, 12, 1), 0xffffff);
    const blurQualityThree = await render(new BlurFilter(12, 12, 3), 0xffffff);
    assert(alphaMass(blurQualityThree) !== alphaMass(blurQualityOne), "quality passes did not change the GPU result");
    assert(blurQualityThree.width > blurQualityOne.width && blurQualityThree.height > blurQualityOne.height,
        `quality-dependent kernel support was clipped: q1=${blurQualityOne.width}x${blurQualityOne.height}, q3=${blurQualityThree.width}x${blurQualityThree.height}`);

    const glowWeak = await render(new GlowFilter(0xff0000, 0.5, 12, 12, 0.5, 1), 0xffffff);
    const glowStrong = await render(new GlowFilter(0xff0000, 0.5, 12, 12, 4, 2), 0xffffff);
    assert(redOutsideSource(glowStrong) > redOutsideSource(glowWeak), "Glow alpha/strength/quality did not increase the red halo");

    const evenGlow = new GlowFilter(0x622e02, 1, 4, 4, 3, 1);
    const normalEvenGlow = await renderPlacedStage(evenGlow, false, false);
    const reflectedEvenGlow = await renderPlacedStage(evenGlow, true, false);
    assertPixelsEqual("reflected authored glow retains the screen-space even-kernel orientation", normalEvenGlow, reflectedEvenGlow);
    assertPixelsEqual("vertically reflected authored glow retains the screen-space even-kernel orientation",
        normalEvenGlow, await renderPlacedStage(evenGlow, false, true));
    const directedShadow = new DropShadowFilter(5, 0, 0x00ff00, 0.75, 4, 4, 2, 1, false, false, true);
    assertPixelsEqual("reflected authored shadow retains its screen-space displacement",
        await renderPlacedStage(directedShadow, false, false), await renderPlacedStage(directedShadow, true, false));
    const directedBevel = createFlashAuthoredBevelFilter({
        sourceType: "BEVELFILTER", distance: 3, angleRadians: 0,
        highlightColor: 0xff8822, highlightAlpha: 1, shadowColor: 0x251a70, shadowAlpha: 1,
        blurX: 4, blurY: 4, strength: 1, passes: 1,
        innerShadow: false, onTop: true, knockout: false, compositeSource: true,
    });
    assertPixelsEqual("reflected authored bevel retains its screen-space fields",
        await renderPlacedStage(directedBevel, false, false), await renderPlacedStage(directedBevel, true, false));

    const shadow = await render(new DropShadowFilter(10, 0, 0x00ff00, 0.75, 4, 4, 2, 2, false, false, true), 0xffffff);
    const shadowBounds = colorBounds(shadow, ([r, g, b, a]) => a > 4 && g > r * 1.5 && g > b * 1.5);
    assert(shadowBounds.count > 0, "DropShadow hideObject produced no colored shadow pixels");
    assert(shadowBounds.centerX > 28, `DropShadow angle/distance did not move right: ${JSON.stringify(shadowBounds)}`);
    assert(sourceAlpha(shadow) < 128, "DropShadow hideObject retained the opaque source");

    const gradientBevel = await render(new GradientBevelFilter(
        6, 45, [0x182848, 0xffffff, 0xff7a18], [230 / 255, 0, 242 / 255], [0, 128, 255],
        6, 6, 1.7, 2, "full", false,
    ), 0xffffff);
    const authoredBevel = await render(createFlashAuthoredBevelFilter({
        sourceType: "BEVELFILTER", distance: 8, angleRadians: 205 * Math.PI / 180,
        highlightColor: 0xff8822, highlightAlpha: 225 / 255,
        shadowColor: 0x251a70, shadowAlpha: 195 / 255,
        blurX: 9, blurY: 5, strength: 2.4, passes: 1,
        innerShadow: true, onTop: false, knockout: true, compositeSource: false,
    }), 0xffffff);
    const outerKnockout = await render(new GradientBevelFilter(
        10, 120, [0x160835, 0x8a2be2, 0x00ffc8, 0xfff066], [0, 180 / 255, 240 / 255, 1], [0, 31, 193, 255],
        5, 9, 1.35, 1, "outer", true,
    ), 0xffffff);
    const authoredBevelRepeat = await render(createFlashAuthoredBevelFilter({
        sourceType: "BEVELFILTER", distance: 8, angleRadians: 205 * Math.PI / 180,
        highlightColor: 0xff8822, highlightAlpha: 225 / 255,
        shadowColor: 0x251a70, shadowAlpha: 195 / 255,
        blurX: 9, blurY: 5, strength: 2.4, passes: 1,
        innerShadow: true, onTop: false, knockout: true, compositeSource: false,
    }), 0xffffff);
    const gradientBevelFingerprint = fingerprint(gradientBevel);
    const authoredBevelFingerprint = fingerprint(authoredBevel);
    const outerKnockoutFingerprint = fingerprint(outerKnockout);
    const authoredBevelRepeatFingerprint = fingerprint(authoredBevelRepeat);
    // These are pinned readbacks from the real Laya WebGL command path above,
    // not values produced by the CPU filter oracle.
    assertFingerprint("GradientBevelFilter", gradientBevelFingerprint,
        { width: 84, height: 84, hash: "265163fe", channels: [47950, 40274, 35883, 62550], alpha: 62550 });
    assertFingerprint("authored BEVELFILTER", authoredBevelFingerprint,
        { width: 88, height: 76, hash: "be43668a", channels: [3725, 2061, 1710, 6197], alpha: 6197 });
    assertFingerprint("authored BEVELFILTER after teardown/reallocation", authoredBevelRepeatFingerprint,
        { width: 88, height: 76, hash: "be43668a", channels: [3725, 2061, 1710, 6197], alpha: 6197 });
    assertFingerprint("GradientBevelFilter outer knockout", outerKnockoutFingerprint,
        { width: 78, height: 90, hash: "aada074d", channels: [334040, 993687, 1229230, 1497301], alpha: 1497301 });

    const stageShadowFilter = new DropShadowFilter(10, 0, 0x00ff00, 0.75, 4, 4, 2, 2, false, false, true);
    const stageShadow = await renderStage(stageShadowFilter, 0xffffff, 1);
    const stageShadowBounds = colorBounds(stageShadow, ([r, g, b, a]) => a > 4 && g > r * 1.5 && g > b * 1.5);
    assert(stageShadowBounds.centerX > 34,
        `stage/subpass asymmetric shadow bounds lost the positive-x offset: ${JSON.stringify(stageShadowBounds)}`);
    const stageChained = alphaBounds(await renderStage([stageShadowFilter, new BlurFilter(8, 8, 2)], 0xffffff, 1));
    assert(stageChained.width > stageShadowBounds.width && stageChained.height > stageShadowBounds.height,
        `ordered shadow/blur growth did not accumulate: shadow=${JSON.stringify(stageShadowBounds)}, chain=${JSON.stringify(stageChained)}`);

    const alphaOffset = await render(new ColorMatrixFilter([
        0, 0, 0, 0, 255,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 128,
    ]), 0x000000);
    const offsetPixel = brightestAlpha(alphaOffset);
    assert(between(offsetPixel[3], 120, 136), `alpha offset was not applied: ${offsetPixel}`);
    assert(between(offsetPixel[0], 120, 136), `RGB offset was not premultiplied by output alpha: ${offsetPixel}`);

    const alphaToBlue = await render(new ColorMatrixFilter([
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 1, 0,
        0, 0, 0, 1, 0,
    ]), 0x000000);
    const bluePixel = brightestAlpha(alphaToBlue);
    assert(bluePixel[2] > 240 && bluePixel[0] < 8 && bluePixel[1] < 8, `alpha-to-RGB cross term failed: ${bluePixel}`);

    const redToAlpha = await render(new ColorMatrixFilter([
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        0, 0, 1, 0, 0,
        1, 0, 0, 0, 0,
    ]), 0xff0000);
    const redPixel = brightestAlpha(redToAlpha);
    assert(redPixel[3] > 240 && redPixel[0] > 240, `RGB-to-alpha cross term failed: ${redPixel}`);

    const specialBlur = await render(new BlurFilter(Number.NaN, Number.NaN, 1), 0xffffff);
    const specialGlow = await render(new GlowFilter(0xff0000, 1, Number.NaN, Number.NaN, 1, 1), 0xffffff);
    const specialShadow = await render(new DropShadowFilter(Number.NaN, Number.NaN, 0x00ff00, 1,
        Number.NaN, Number.NaN, 1, 1, false, false, true), 0xffffff);
    assert(alphaMass(specialBlur) > 0 && alphaMass(specialGlow) > 0 && alphaMass(specialShadow) > 0,
        `special-value filters produced an empty or invalid target: ${gpuLogs.join(" | ")}`);
    assert(!gpuLogs.some(message => /shader|compile|framebuffer|NaN/i.test(message)),
        `special-value filters reached invalid GPU state: ${gpuLogs.join(" | ")}`);

    const stageBaseline = await renderStage(null, 0xffffff, 1);
    assert(alphaMass(stageBaseline) > 1000, `Laya stage/subpass framebuffer baseline was empty: ${alphaMass(stageBaseline)}`);

    const stageQualityOne = alphaBounds(await renderStage(new BlurFilter(12, 12, 1), 0xffffff, 1));
    const stageQualityBlur = await renderStage(new BlurFilter(12, 12, 3), 0xffffff, 1);
    const stageQualityBounds = alphaBounds(stageQualityBlur);
    assert(stageQualityBounds.width > stageQualityOne.width + 8 && stageQualityBounds.height > stageQualityOne.height + 8,
        `stage/subpass quality did not expand repeated-kernel support: q1=${JSON.stringify(stageQualityOne)}, q3=${JSON.stringify(stageQualityBounds)}`);
    assert(between(stageQualityOne.centerX, 27.8, 28.2) && between(stageQualityOne.centerY, 34.8, 35.2),
        `even-kernel physical half-pixel placement was reversed or clipped: ${JSON.stringify(stageQualityOne)}`);
    assert(Math.abs(alphaMass(blurQualityThree) - alphaMass(blurQualityOne)) < alphaMass(blurQualityOne) * 0.01,
        "quality-dependent expansion lost blur alpha mass at repeated-kernel edges");

    const stageAlphaOffset = await renderStage(new ColorMatrixFilter([
        0, 0, 0, 0, 255,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 255,
    ]), 0x000000, 0);
    const stageOffsetPixel = brightestAlpha(stageAlphaOffset);
    assert(stageOffsetPixel[0] > 240 && stageOffsetPixel[1] < 8 && stageOffsetPixel[2] < 8,
        `DisplayObject owner.alpha=0 erased the matrix alpha offset: ${stageOffsetPixel}`);

    const stageFractionalAlpha = await renderStage(new ColorMatrixFilter([
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 1, 0,
        0, 0, 0, 1, 0,
    ]), 0x000000, 0.5);
    const fractionalPixel = brightestAlpha(stageFractionalAlpha);
    assert(between(fractionalPixel[2], 56, 72) && fractionalPixel[0] < 8 && fractionalPixel[1] < 8,
        `DisplayObject fractional owner alpha was not consumed exactly once: ${fractionalPixel}`);

    const stageTwoMatrices = await renderStage([
        new ColorMatrixFilter(),
        new ColorMatrixFilter([
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
            0, 0, 0, 1, 0,
            0, 0, 0, 1, 0,
        ]),
    ], 0x000000, 0.5);
    const twoMatrixPixel = brightestAlpha(stageTwoMatrices);
    assert(between(twoMatrixPixel[2], 56, 72) && twoMatrixPixel[0] < 8 && twoMatrixPixel[1] < 8,
        `two ColorMatrixFilters consumed owner alpha more than once: ${twoMatrixPixel}`);

    return {
        renderer: document.querySelector("canvas")?.getContext("webgl2") ? "WebGL" : "unknown",
        overlay: {
            upper: pixelAt(overlay, 32, 56),
            lower: pixelAt(overlay, 32, 8),
            fingerprint: fingerprint(overlay),
        },
        blur: { horizontalBounds, verticalBounds, stageQualityOne, stageQualityBounds,
            qualityMass: [alphaMass(blurQualityOne), alphaMass(blurQualityThree)] },
        glow: { weak: redOutsideSource(glowWeak), strong: redOutsideSource(glowStrong) },
        shadow: { raw: shadowBounds, stage: stageShadowBounds, chained: stageChained },
        bevel: { gradient: gradientBevelFingerprint, authored: authoredBevelFingerprint,
            outerKnockout: outerKnockoutFingerprint, authoredRepeat: authoredBevelRepeatFingerprint },
        matrix: { offsetPixel, alphaToBlue: bluePixel, redToAlpha: redPixel,
            stageOwnerAlphaZero: stageOffsetPixel, stageOwnerAlphaHalf: fractionalPixel,
            stageOwnerAlphaTwoMatrices: twoMatrixPixel },
    };
}

function assertFilteredCompositeVertexIsolation(): void {
    type FilteredHost = {
        _subStructRender: { _internalInfo: { vertexSize: object } };
    };
    const first = new DisplayObject();
    first.pos(5, 6);
    first.graphics.drawRect(0, 0, 8, 7, "#ffffff");
    first.filters = [new GlowFilter(0xff0000, 1, 4, 4, 1, 1)];
    const second = new DisplayObject();
    second.pos(35, 39);
    second.graphics.drawRect(0, 0, 13, 9, "#ffffff");
    second.filters = [new GlowFilter(0x00ff00, 1, 8, 6, 1, 1)];
    Laya.stage.addChild(first);
    Laya.stage.addChild(second);
    Laya.stage.render(performance.now());
    const firstVertex = (first as unknown as FilteredHost)._subStructRender._internalInfo.vertexSize;
    const secondVertex = (second as unknown as FilteredHost)._subStructRender._internalInfo.vertexSize;
    assert(firstVertex !== secondVertex,
        "filtered composites must not retain the shared Vector4 temporary as persistent vertex state");
    first.destroy();
    second.destroy();
}

async function renderOverlayStage(): Promise<Readback> {
    const backdrop = new LayaSprite();
    backdrop.graphics.drawRect(0, 0, 64, 32, "#40c080");
    backdrop.graphics.drawRect(0, 32, 64, 32, "#c04020");
    const source = new LayaSprite();
    source.graphics.drawRect(0, 0, 64, 64, "#c040ff");
    source.blendMode = "overlay";
    Laya.stage.addChild(backdrop);
    Laya.stage.addChild(source);
    Laya.stage.render(performance.now());
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    if (!gl) throw new Error("Laya stage WebGL context was not found");
    const pixels = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    source.destroy();
    backdrop.destroy();
    return { width: 64, height: 64, pixels };
}

async function renderPlacedStage(filter: Filter, reflectedX: boolean, reflectedY: boolean): Promise<Readback> {
    const sprite = new DisplayObject();
    sprite.graphics.drawRect(0, 0, 8, 8, "#ffffff");
    sprite.pos(reflectedX ? 32 : 24, reflectedY ? 32 : 24);
    sprite.scaleX = reflectedX ? -1 : 1;
    sprite.scaleY = reflectedY ? -1 : 1;
    setDisplayObjectNativeFilters(sprite, [filter]);
    Laya.stage.addChild(sprite);
    Laya.stage.render(performance.now());
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    if (!gl) throw new Error("Laya stage WebGL context was not found");
    const pixels = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    sprite.destroy();
    return { width: 64, height: 64, pixels };
}

async function renderStage(filter: BitmapFilter | readonly BitmapFilter[] | null, color: number, ownerAlpha: number): Promise<Readback> {
    const sprite = new DisplayObject();
    sprite.graphics.drawRect(24, 24, 8, 8, `#${color.toString(16).padStart(6, "0")}`);
    sprite.alpha = ownerAlpha;
    if (filter) sprite.filters = Array.isArray(filter) ? filter : [filter];
    Laya.stage.addChild(sprite);
    Laya.stage.render(performance.now());
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    if (!gl) throw new Error("Laya stage WebGL context was not found");
    const pixels = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (let index = 0; index < pixels.length; index += 4)
        pixels[index + 3] = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
    sprite.destroy();
    return { width: 64, height: 64, pixels };
}

async function render(filter: Filter | null, color: number): Promise<Readback> {
    const sprite = new DisplayObject();
    sprite.graphics.drawRect(24, 24, 8, 8, `#${color.toString(16).padStart(6, "0")}`);
    const source = sprite.drawToRenderTexture2D(64, 64, 0, 0);
    let destination = source;
    let postProcess: PostProcess2D | null = null;
    if (filter) {
        postProcess = new PostProcess2D();
        postProcess.owner = sprite as unknown as LayaSprite;
        postProcess.setResource(source);
        postProcess.addEffect(filter.getEffect());
        postProcess._render();
        postProcess._context._apply();
        destination = postProcess.getDestRT();
    }
    const pixels = destination.getData(0, 0, destination.width, destination.height) as Uint8Array;
    const result = { width: destination.width, height: destination.height, pixels: new Uint8Array(pixels) };
    postProcess?.destroy();
    source.destroy();
    sprite.destroy();
    return result;
}

function pixelAt(image: Readback, x: number, y: number): Pixel {
    const offset = (y * image.width + x) * 4;
    return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], image.pixels[offset + 3]];
}

function alphaBounds(image: Readback) {
    return colorBounds(image, pixel => pixel[3] > 4);
}

function colorBounds(image: Readback, predicate: (pixel: Pixel) => boolean) {
    let left = image.width, top = image.height, right = -1, bottom = -1, sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if (!predicate(pixelAt(image, x, y))) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        sumX += x; sumY += y; count++;
    }
    return { left, top, right, bottom, width: right >= left ? right - left + 1 : 0, height: bottom >= top ? bottom - top + 1 : 0,
        centerX: count ? sumX / count : Number.NaN, centerY: count ? sumY / count : Number.NaN, count };
}

function alphaMass(image: Readback): number {
    let result = 0;
    for (let i = 3; i < image.pixels.length; i += 4) result += image.pixels[i];
    return result;
}

function fingerprint(image: Readback) {
    let hash = 0x811c9dc5;
    const channels = [0, 0, 0, 0];
    for (let index = 0; index < image.pixels.length; index++) {
        const value = image.pixels[index];
        channels[index & 3] += value;
        hash ^= value;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return { width: image.width, height: image.height, hash: hash.toString(16).padStart(8, "0"),
        channels, alpha: channels[3] };
}

function assertFingerprint(label: string, actual: ReturnType<typeof fingerprint>, expected: ReturnType<typeof fingerprint>): void {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
        `${label} GPU pixels drifted: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)} logs=${gpuLogs.join(" | ")}`);
}

function assertPixelNear(label: string, actual: Pixel, expected: Pixel, tolerance: number): void {
    assert(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance),
        `${label} GPU pixel drifted: actual=${actual} expected=${expected} tolerance=${tolerance} logs=${gpuLogs.join(" | ")}`);
}

function assertPixelsEqual(label: string, actual: Readback, expected: Readback): void {
    assert(actual.width === expected.width && actual.height === expected.height && actual.pixels.length === expected.pixels.length,
        `${label} dimensions drifted: actual=${actual.width}x${actual.height} expected=${expected.width}x${expected.height}`);
    for (let index = 0; index < actual.pixels.length; index++) {
        if (actual.pixels[index] === expected.pixels[index]) continue;
        const pixel = Math.floor(index / 4);
        throw new Error(`${label} at (${pixel % actual.width}, ${Math.floor(pixel / actual.width)}) channel ${index & 3}: `
            + `actual=${actual.pixels[index]} expected=${expected.pixels[index]}`);
    }
}

function redOutsideSource(image: Readback): number {
    let result = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if (x >= 24 && x < 32 && y >= 24 && y < 32) continue;
        const [r, g, b] = pixelAt(image, x, y);
        result += Math.max(0, r - Math.max(g, b));
    }
    return result;
}

function sourceAlpha(image: Readback): number {
    let result = 0;
    for (let y = 24; y < 32; y++) for (let x = 24; x < 32; x++) result = Math.max(result, pixelAt(image, x, y)[3]);
    return result;
}

function brightestAlpha(image: Readback): Pixel {
    let result: Pixel = [0, 0, 0, 0];
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const candidate = pixelAt(image, x, y);
        if (candidate[3] > result[3]) result = candidate;
    }
    return result;
}

function between(value: number, minimum: number, maximum: number): boolean { return value >= minimum && value <= maximum; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function writeResult(value: unknown): void {
    const node = document.createElement("pre");
    node.id = "flash-filter-gpu-result";
    node.textContent = JSON.stringify(value);
    document.body.replaceChildren(node);
}
