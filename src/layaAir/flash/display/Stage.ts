import { ILaya } from "../../ILaya";
import { Node as LayaNode } from "../../laya/display/Node";
import { isLayaStage, type Stage as LayaStage } from "../../laya/display/Stage";
import { Event } from "../events/Event";
import { FlashEventListener } from "../events/FlashEventRouter";
import { DisplayObject, isFlashDisplayObject } from "./DisplayObject";
import { FlashStageBootstrapOptions, FlashStageBoundary } from "./FlashStageBoundary";
import { InteractiveObject } from "./InteractiveObject";

const STAGE_TOKEN = Symbol("LayaAir.flash.Stage");
const STAGE_VALUES = new WeakSet<object>();
const STAGE_NATIVE = new WeakMap<Stage, LayaStage>();
const NATIVE_STAGE_VIEWS = new WeakMap<object, Stage>();
const STAGE_LOADER_INFOS = new WeakMap<Stage, FlashStageLoaderInfo>();

/** Minimal LoaderInfo surface owned by the document Stage bootstrap. */
export interface FlashStageLoaderInfo {
    readonly parameters: Readonly<Record<string, string>>;
}

/** @internal Read-only nominal proof for canonical Flash Stage views. */
export function isFlashStage(value: unknown): value is Stage {
    return typeof value === "object" && value !== null && STAGE_VALUES.has(value);
}

function requireView(value: unknown): { readonly view: Stage, readonly stage: LayaStage } {
    if (!isFlashStage(value)) throw new TypeError("Flash Stage operation requires an engine-issued Stage view");
    const stage = STAGE_NATIVE.get(value);
    if (!stage || stage !== ILaya.stage || !isLayaStage(stage) || stage.destroyed)
        throw new TypeError("Flash Stage operation requires the live canonical Laya Stage");
    return { view: value, stage };
}

function requireNativeStage(value: unknown): LayaStage {
    if (value !== ILaya.stage || !isLayaStage(value) || value.destroyed)
        throw new TypeError("Flash Stage view requires the live canonical Laya Stage");
    return value;
}

function requireChild(value: unknown): DisplayObject {
    if (!isFlashDisplayObject(value))
        throw new TypeError("Flash Stage child operations require a canonical DisplayObject");
    return value;
}

/**
 * Source-shaped `flash.display.Stage` view over Laya's one native Stage.
 *
 * The view never replaces, subclasses, or decorates the native Stage. Laya
 * retains display-list, rendering, focus and scheduler ownership; this class
 * exposes only the retained Flash-facing surface through authenticated native
 * delegation. A view is minted by `Stage.fromNative` after `Laya.init` and is
 * invalid as soon as that Stage is destroyed or replaced.
 */
export class Stage {
    constructor(token: typeof STAGE_TOKEN, nativeStage: LayaStage) {
        if (token !== STAGE_TOKEN)
            throw new TypeError("Stage views are created only for the live Laya Stage");
        const stage = requireNativeStage(nativeStage);
        if (NATIVE_STAGE_VIEWS.has(stage as object))
            throw new Error("The live Laya Stage already has a source-shaped Stage view");
        STAGE_VALUES.add(this);
        STAGE_NATIVE.set(this, stage);
        NATIVE_STAGE_VIEWS.set(stage as object, this);
        const loaderInfo = Object.freeze(Object.defineProperty({}, "parameters", {
            configurable: false,
            enumerable: true,
            get: () => FlashStageBoundary.getBootstrap(requireView(this).stage).loaderParameters,
        })) as FlashStageLoaderInfo;
        STAGE_LOADER_INFOS.set(this, loaderInfo);
        Object.freeze(this);
    }

    /** Returns the stable source view for the live canonical native Stage. */
    static fromNative(nativeStage: LayaStage): Stage {
        const stage = requireNativeStage(nativeStage);
        const existing = NATIVE_STAGE_VIEWS.get(stage as object);
        return existing ?? new Stage(STAGE_TOKEN, stage);
    }

    /** Returns the live Stage view for an attached canonical DisplayObject. */
    static forDisplayObject(value: DisplayObject): Stage | null {
        const nativeStage = FlashStageBoundary.stageOf(value);
        return nativeStage ? Stage.fromNative(nativeStage) : null;
    }

    get align(): "TL" { return FlashStageBoundary.getBootstrap(requireView(this).stage).align; }
    set align(value: "TL") { this._configure({ align: value }); }

    get scaleMode(): "noScale" { return FlashStageBoundary.getBootstrap(requireView(this).stage).scaleMode; }
    set scaleMode(value: "noScale") { this._configure({ scaleMode: value }); }

    get quality(): "high" | "best" { return FlashStageBoundary.getBootstrap(requireView(this).stage).quality; }
    set quality(value: "high" | "best") { this._configure({ quality: value }); }

    get showDefaultContextMenu(): false {
        return FlashStageBoundary.getBootstrap(requireView(this).stage).showDefaultContextMenu;
    }
    set showDefaultContextMenu(value: false) { this._configure({ showDefaultContextMenu: value }); }

    get frameRate(): number { return FlashStageBoundary.getFrameRate(requireView(this).stage); }
    set frameRate(value: number) { FlashStageBoundary.setFrameRate(requireView(this).stage, value); }

    get stageWidth(): number { return FlashStageBoundary.getWidth(requireView(this).stage); }
    get stageHeight(): number { return FlashStageBoundary.getHeight(requireView(this).stage); }

    get focus(): InteractiveObject | null { return FlashStageBoundary.getFocus(requireView(this).stage); }
    set focus(value: InteractiveObject | null) { FlashStageBoundary.setFocus(requireView(this).stage, value); }

    get loaderInfo(): FlashStageLoaderInfo {
        const { view } = requireView(this);
        return STAGE_LOADER_INFOS.get(view)!;
    }

    get numChildren(): number { return requireView(this).stage.numChildren; }
    get parent(): null { requireView(this); return null; }
    get root(): Stage { return requireView(this).view; }
    get stage(): Stage { return requireView(this).view; }

    addChild<T extends DisplayObject>(child: T): T {
        const { stage } = requireView(this);
        requireChild(child);
        stage.addChild(child);
        return child;
    }

    addChildAt<T extends DisplayObject>(child: T, index: number): T {
        const { stage } = requireView(this);
        requireChild(child);
        stage.addChildAt(child, index);
        return child;
    }

    getChildAt(index: number): DisplayObject {
        const child = requireView(this).stage.getChildAt<LayaNode>(index);
        return requireChild(child);
    }

    getChildByName(name: string): DisplayObject | null {
        const child = requireView(this).stage.getChildByName<LayaNode>(name);
        return child == null ? null : requireChild(child);
    }

    removeChild<T extends DisplayObject>(child: T): T {
        const { stage } = requireView(this);
        requireChild(child);
        stage.removeChild(child);
        return child;
    }

    removeChildAt(index: number): DisplayObject {
        return requireChild(requireView(this).stage.removeChildAt(index));
    }

    contains(child: DisplayObject): boolean {
        const { stage } = requireView(this);
        requireChild(child);
        return stage.contains(child);
    }

    addEventListener(type: string, listener: FlashEventListener, useCapture = false,
        priority = 0, useWeakReference = false): void {
        FlashStageBoundary.addEventListener(requireView(this).stage, type, listener,
            useCapture, priority, useWeakReference);
    }

    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        FlashStageBoundary.removeEventListener(requireView(this).stage, type, listener, useCapture);
    }

    dispatchEvent(event: Event): boolean {
        return FlashStageBoundary.dispatchEvent(requireView(this).stage, event);
    }

    hasEventListener(type: string): boolean {
        return FlashStageBoundary.hasEventListener(requireView(this).stage, type);
    }

    willTrigger(type: string): boolean { return this.hasEventListener(type); }

    private _configure(patch: Partial<FlashStageBootstrapOptions>): void {
        const { stage } = requireView(this);
        const current = FlashStageBoundary.getBootstrap(stage);
        FlashStageBoundary.configure(stage, { ...current, ...patch });
    }
}
