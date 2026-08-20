import { Config } from "../../src/layaAir/Config";
import { Laya } from "../../src/layaAir/Laya";
import { AnimationClip2D } from "../../src/layaAir/laya/components/AnimationClip2D";
import { HierarchyParser } from "../../src/layaAir/laya/loaders/HierarchyParser";
import { Loader } from "../../src/layaAir/laya/net/Loader";
import { PrefabImpl } from "../../src/layaAir/laya/resource/PrefabImpl";
import { MovieClip, TextField } from "../../src/layaAir/flash";
import {
    registerAuthoredContentRuntime,
    registerAuthoredContentPrimitives,
} from "../../src/extensions/authoredContent/runtime";
import "../../src/layaAir/laya/ModuleDef";
import "../../src/layaAir/laya/ui/ModuleDef";
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

interface Symbol21BrowserBundle {
    readonly hierarchy: Record<string, unknown>;
    readonly clips: Readonly<Record<string, string>>;
    readonly images: Readonly<Record<string, string>>;
}

interface AuthoredStageMetadata {
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
    readonly frameCount: number;
    readonly backgroundColor: {
        readonly alpha: number;
        readonly color: number;
    };
}

let stagePixelWidth = 0;
let stagePixelHeight = 0;

declare global {
    interface Window {
        __symbol21Bundle: Symbol21BrowserBundle;
        __symbol21Result?: unknown;
    }
}

class LoadingScreenSkin extends MovieClip {
    HappyBear!: MovieClip;
    SP_ProgressBigBar!: MovieClip;
    TF_ProgressText!: TextField;
    TF_LoadingTips!: TextField;
    TF_LoadingTipsExtra!: TextField;
}

void main().then(result => publish({ ok: true, result }), error => publish({
    ok: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
}));

async function main(): Promise<unknown> {
    const authoredStage = readAuthoredStage(window.__symbol21Bundle.hierarchy);
    stagePixelWidth = authoredStage.width;
    stagePixelHeight = authoredStage.height;
    Config.isAlpha = false;
    Config.preserveDrawingBuffer = true;
    await Laya.init(authoredStage.width, authoredStage.height);
    Laya.stage.bgColor = rgbHex(authoredStage.backgroundColor.color);
    registerAuthoredContentPrimitives();
    registerAuthoredContentRuntime([{
        id: "Processors_Mini.Accessories.LoadingScreenSkin",
        ctor: LoadingScreenSkin,
        sourceType: "MovieClip",
        serializedType: "Sprite",
    }]);
    for (const [id, base64] of Object.entries(window.__symbol21Bundle.clips)) {
        const clip = AnimationClip2D._parse(decodeBase64(base64));
        clip._setCreateURL(`res://${id}`, id);
        const type = Loader.getURLInfo(id);
        Loader._cacheRes(id, clip, type.typeId, type.main);
    }
    for (const [id, dataUrl] of Object.entries(window.__symbol21Bundle.images)) {
        const texture = await Laya.loader.load(dataUrl, Loader.IMAGE);
        if (!texture)
            throw new Error(`Texture '${id}' failed to load.`);
        const type = Loader.getURLInfo(id);
        Loader._cacheRes(`res://${id}`, texture, type.typeId, type.main);
    }
    const errors: unknown[] = [];
    const skin = new PrefabImpl(HierarchyParser, window.__symbol21Bundle.hierarchy)
        .create({}, errors) as LoadingScreenSkin;
    if (errors.length !== 0)
        throw new Error(errors.map(String).join("; "));
    if (!(skin instanceof LoadingScreenSkin)
        || !(skin.HappyBear instanceof MovieClip)
        || !(skin.SP_ProgressBigBar instanceof MovieClip)
        || !(skin.TF_ProgressText instanceof TextField)
        || !(skin.TF_LoadingTips instanceof TextField)
        || !(skin.TF_LoadingTipsExtra instanceof TextField))
        throw new Error("Authored application linkage injection is incomplete.");
    skin.TF_ProgressText.text = "Loading 50%";
    skin.TF_LoadingTips.text = "Tip: Soul Reapers protect the living world.";
    skin.TF_LoadingTipsExtra.text = "Preparing Karakura Town";
    skin.SP_ProgressBigBar.scaleX = 0.5;
    Laya.stage.addChild(skin);

    const poses: Array<{ frame: number; active: number; pixelHash: number }> = [];
    for (const frame of [1, 5, 9, 13] as const) {
        skin.HappyBear.gotoAndStop(frame);
        Laya.stage.render(performance.now());
        const active = Array.from({ length: skin.HappyBear.numChildren }, (_, index) => skin.HappyBear.getChildAt(index).visible)
            .findIndex(Boolean);
        if (skin.HappyBear.currentFrame !== frame)
            throw new Error(`HappyBear frame navigation reported ${skin.HappyBear.currentFrame}, expected ${frame}.`);
        poses.push({ frame, active, pixelHash: frameBufferHash() });
    }
    if (new Set(poses.map(value => value.pixelHash)).size !== 4)
        throw new Error("HappyBear rendered poses are not visually distinct.");
    skin.HappyBear.gotoAndPlay(1);
    const playbackStart = skin.HappyBear.currentFrame;
    const playbackEnd = await waitForFrameAdvance(skin.HappyBear, playbackStart);
    if (!skin.HappyBear.isPlaying)
        throw new Error(`HappyBear did not advance in native playback: playing=${skin.HappyBear.isPlaying}, start=${playbackStart}, end=${playbackEnd}.`);
    skin.HappyBear.stop();
    if (skin.HappyBear.isPlaying)
        throw new Error("HappyBear did not stop native playback.");
    skin.HappyBear.gotoAndStop(1);
    if (skin.HappyBear.currentFrame !== 1 || skin.HappyBear.isPlaying)
        throw new Error("HappyBear gotoAndStop did not restore stopped frame 1.");
    Laya.stage.render(performance.now());
    const summary = frameBufferSummary();
    if (summary.nonBlack < 1000 || summary.blue < 100)
        throw new Error(`Rendered loading screen is incomplete: ${JSON.stringify(summary)}`);
    return {
        renderer: document.querySelector("canvas")?.getContext("webgl2") ? "WebGL2" : "WebGL",
        stage: authoredStage,
        childNames: [
            skin.HappyBear.name,
            skin.SP_ProgressBigBar.name,
            skin.TF_ProgressText.name,
            skin.TF_LoadingTips.name,
            skin.TF_LoadingTipsExtra.name,
        ],
        text: [skin.TF_ProgressText.text, skin.TF_LoadingTips.text, skin.TF_LoadingTipsExtra.text],
        formats: [
            [skin.TF_ProgressText.defaultTextFormat.font, skin.TF_ProgressText.defaultTextFormat.size, skin.TF_ProgressText.defaultTextFormat.bold],
            [skin.TF_LoadingTips.defaultTextFormat.font, skin.TF_LoadingTips.defaultTextFormat.size, skin.TF_LoadingTips.defaultTextFormat.bold],
            [skin.TF_LoadingTipsExtra.defaultTextFormat.font, skin.TF_LoadingTipsExtra.defaultTextFormat.size, skin.TF_LoadingTipsExtra.defaultTextFormat.bold],
        ],
        progressScaleX: skin.SP_ProgressBigBar.scaleX,
        totalFrames: skin.HappyBear.totalFrames,
        playback: { start: playbackStart, end: playbackEnd },
        poses,
        pixels: summary,
    };
}

function waitForFrameAdvance(movieClip: MovieClip, startFrame: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const deadline = performance.now() + 2000;
        const sample = () => {
            const frame = movieClip.currentFrame;
            if (frame !== startFrame) resolve(frame);
            else if (performance.now() >= deadline) reject(new Error(`MovieClip remained on frame ${startFrame}.`));
            else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
}

function frameBufferHash(): number {
    const pixels = readPixels();
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
        hash ^= pixels[index] ^ pixels[index + 1] ^ pixels[index + 2] ^ pixels[index + 3];
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function frameBufferSummary(): { nonBlack: number; blue: number } {
    const pixels = readPixels();
    let nonBlack = 0;
    let blue = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blueValue = pixels[index + 2];
        if (red > 5 || green > 5 || blueValue > 5) nonBlack++;
        if (blueValue > red * 1.4 && blueValue > green * 1.1 && blueValue > 60) blue++;
    }
    return { nonBlack, blue };
}

function readPixels(): Uint8Array {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2", { preserveDrawingBuffer: true })
        || canvas?.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("Laya WebGL context is unavailable.");
    gl.finish();
    const pixels = new Uint8Array(stagePixelWidth * stagePixelHeight * 4);
    gl.readPixels(0, 0, stagePixelWidth, stagePixelHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
}

function readAuthoredStage(hierarchy: Record<string, unknown>): AuthoredStageMetadata {
    const metadata = hierarchy._$authoredContent;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
        throw new Error("Emitted authored-content metadata is missing.");
    const stage = (metadata as Record<string, unknown>).stage;
    if (!stage || typeof stage !== "object" || Array.isArray(stage))
        throw new Error("Emitted authored stage metadata is missing.");
    const value = stage as Record<string, unknown>;
    const background = value.backgroundColor;
    if (!background || typeof background !== "object" || Array.isArray(background))
        throw new Error("Emitted authored stage background is missing.");
    const backgroundValue = background as Record<string, unknown>;
    const width = exactPositiveInteger(value.width, "stage.width");
    const height = exactPositiveInteger(value.height, "stage.height");
    const frameRate = exactPositiveInteger(value.frameRate, "stage.frameRate");
    const frameCount = exactPositiveInteger(value.frameCount, "stage.frameCount");
    const alpha = backgroundValue.alpha;
    const color = backgroundValue.color;
    if (alpha !== 1)
        throw new Error(`Emitted authored stage alpha '${String(alpha)}' is unsupported.`);
    if (typeof color !== "number" || !Number.isInteger(color) || color < 0 || color > 0xffffff)
        throw new Error(`Emitted authored stage color '${String(color)}' is invalid.`);
    return { width, height, frameRate, frameCount, backgroundColor: { alpha, color } };
}

function exactPositiveInteger(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
        throw new Error(`Emitted authored ${label} '${String(value)}' is invalid.`);
    return value;
}

function rgbHex(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
}

function decodeBase64(value: string): ArrayBuffer {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
}

function publish(value: unknown): void {
    window.__symbol21Result = value;
    const node = document.createElement("pre");
    node.id = "symbol21-result";
    node.hidden = true;
    node.textContent = JSON.stringify(value);
    document.body.appendChild(node);
}
