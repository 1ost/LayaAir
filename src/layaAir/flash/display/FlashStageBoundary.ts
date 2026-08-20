import { Config } from "../../Config";
import { ILaya } from "../../ILaya";
import { Node as LayaNode } from "../../laya/display/Node";
import { isLayaStage, type Stage as LayaStage } from "../../laya/display/Stage";
import { Render } from "../../laya/renders/Render";
import { Browser } from "../../laya/utils/Browser";
import { Event } from "../events/Event";
import { FlashEventListener, FlashEventRouter } from "../events/FlashEventRouter";
import { isFlashDisplayObject, DisplayObject } from "./DisplayObject";
import {
    isFlashInteractiveObject, InteractiveObject, resolveFlashFocusOwner
} from "./InteractiveObject";
import { isFlashStage, Stage } from "./Stage";

type MutableStage = LayaStage & { focus: LayaNode | null };
type FocusSeam = { _applyNativeFocus(value: boolean): void };

const STAGE_ROUTERS = new WeakMap<object, FlashEventRouter>();
const STAGE_BOOTSTRAPS = new WeakMap<object, FlashStageBootstrap>();
const LOADER_PARAMETER_VALUES = new WeakSet<object>();
const STAGE_VIEWPORT_OWNERS = new WeakMap<object, FlashStageViewportOwner>();
const STAGE_EVENT_TARGETS = new WeakMap<object, Stage>();

interface FlashStageViewportRecord {
    readonly stage: LayaStage;
    width: number;
    height: number;
}

const VIEWPORT_OWNER_RECORDS = new WeakMap<object, FlashStageViewportRecord>();

declare const FLASH_STAGE_LOADER_PARAMETERS: unique symbol;
type FlashStageLoaderParameters = Readonly<Record<string, string>> & {
    readonly [FLASH_STAGE_LOADER_PARAMETERS]: true;
};

export interface FlashStageBootstrapOptions {
    readonly align: "TL";
    readonly scaleMode: "noScale";
    readonly quality: "high" | "best";
    readonly showDefaultContextMenu: false;
    readonly loaderParameters: FlashStageLoaderParameters;
}

export interface FlashStageBootstrap extends FlashStageBootstrapOptions {}

/** Immutable launch-time design viewport supplied by the application bootstrap. */
export interface FlashStageViewport {
    readonly width: number;
    readonly height: number;
}

/**
 * Opaque authority for publishing later viewport changes. The engine issues
 * exactly one owner for a live Stage; viewport state never resides on the
 * public Stage or owner object.
 */
export interface FlashStageViewportOwner {
    readonly stageWidth: number;
    readonly stageHeight: number;
    resizeViewport(width: number, height: number): void;
}

function requireCurrentStage(stage: LayaStage): LayaStage {
    if (stage !== ILaya.stage || !isLayaStage(stage) || stage.destroyed)
        throw new TypeError("Flash Stage boundary requires the live canonical Laya Stage");
    return stage;
}

function requireViewportDimension(value: number, name: "width" | "height"): number {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new RangeError(`Flash Stage viewport ${name} must be a non-negative safe integer`);
    return value;
}

function requireViewportOwner(value: unknown): FlashStageViewportRecord {
    if ((typeof value !== "object" && typeof value !== "function") || value === null)
        throw new TypeError("Flash Stage viewport changes require the exact engine-issued owner");
    const record = VIEWPORT_OWNER_RECORDS.get(value as object);
    if (!record || STAGE_VIEWPORT_OWNERS.get(record.stage as object) !== value)
        throw new TypeError("Flash Stage viewport changes require the exact engine-issued owner");
    return record;
}

class EngineFlashStageViewportOwner implements FlashStageViewportOwner {
    constructor(stage: LayaStage, width: number, height: number) {
        VIEWPORT_OWNER_RECORDS.set(this, { stage, width, height });
    }

    get stageWidth(): number { return requireViewportOwner(this).width; }
    get stageHeight(): number { return requireViewportOwner(this).height; }

    resizeViewport(width: number, height: number): void {
        const record = requireViewportOwner(this);
        requireCurrentStage(record.stage);
        const nextWidth = requireViewportDimension(width, "width");
        const nextHeight = requireViewportDimension(height, "height");
        if (nextWidth === record.width && nextHeight === record.height) return;

        // Publish the complete pair before dispatch. Listener failures never
        // roll back committed viewport state.
        record.width = nextWidth;
        record.height = nextHeight;
        FlashStageBoundary.dispatchEvent(record.stage, new Event(Event.RESIZE, false, false));
    }
}

/**
 * Explicit source-to-native Stage boundary. It never subclasses Stage and
 * never aliases Flash's numeric frameRate to Laya's string throttle property.
 */
export class FlashStageBoundary {
    private constructor() {}

    /** Parses browser launch parameters without admitting live property bags. */
    static parseLoaderParameters(search: string): FlashStageLoaderParameters {
        if (typeof search !== "string")
            throw new TypeError("Flash LoaderInfo parameters require an encoded search string");
        const result = Object.create(null) as Record<string, string>;
        const parameters = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
        for (const [key, value] of parameters) {
            if (Object.prototype.hasOwnProperty.call(result, key))
                throw new TypeError(`Flash LoaderInfo parameter '${key}' is duplicated`);
            Object.defineProperty(result, key, { value, enumerable: true });
        }
        Object.freeze(result);
        LOADER_PARAMETER_VALUES.add(result);
        return result as FlashStageLoaderParameters;
    }

    static stageOf(value: DisplayObject): LayaStage | null {
        if (!isFlashDisplayObject(value))
            throw new TypeError("FlashStageBoundary.stageOf requires a canonical Flash DisplayObject");
        const stage = ILaya.stage;
        if (!isLayaStage(stage) || stage.destroyed) return null;
        let node: LayaNode | null = value;
        while (node) {
            if (node === stage) return stage;
            node = node.parent;
        }
        return null;
    }

    static getFrameRate(stage: LayaStage): number {
        this._requireCurrent(stage);
        return Config.FPS;
    }

    static setFrameRate(stage: LayaStage, value: number): void {
        this._requireCurrent(stage);
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0.01 || value > 1000)
            throw new RangeError("Flash Stage frameRate must be finite and between 0.01 and 1000");
        Config.FPS = value;
        Render.frameInterval = 1000 / value;
    }

    static getFocus(stage: LayaStage): InteractiveObject | null {
        this._requireCurrent(stage);
        const mutable = stage as MutableStage;
        const nativeFocus = mutable.focus;
        const owner = resolveFlashFocusOwner(nativeFocus);
        if (owner && this.stageOf(owner) !== stage) {
            (owner as unknown as FocusSeam)._applyNativeFocus(false);
            if (mutable.focus === nativeFocus) mutable.focus = null;
            return null;
        }
        return owner;
    }

    static setFocus(stage: LayaStage, value: InteractiveObject | null): void {
        this._requireCurrent(stage);
        if (value !== null) {
            if (!isFlashInteractiveObject(value))
                throw new TypeError("Flash Stage focus requires a canonical InteractiveObject or null");
            if (this.stageOf(value) !== stage)
                throw new TypeError("Flash Stage focus target must be attached to that Stage");
        }
        const mutable = stage as MutableStage;
        const current = mutable.focus;
        const currentOwner = resolveFlashFocusOwner(current);
        if (currentOwner === value) return;
        if (currentOwner)
            (currentOwner as unknown as FocusSeam)._applyNativeFocus(false);
        else mutable.focus = null;
        if (value !== null)
            (value as unknown as FocusSeam)._applyNativeFocus(true);
    }

    static getWidth(stage: LayaStage): number {
        this._requireCurrent(stage);
        return this._viewportRecord(stage).width;
    }

    static getHeight(stage: LayaStage): number {
        this._requireCurrent(stage);
        return this._viewportRecord(stage).height;
    }

    /**
     * Claims the Stage design viewport before authored content is attached.
     * Duplicate and reentrant claims are rejected before any publication.
     */
    static claimViewport(stage: LayaStage, initialViewport: FlashStageViewport): FlashStageViewportOwner {
        this._requireCurrent(stage);
        if (STAGE_VIEWPORT_OWNERS.has(stage as object))
            throw new Error("Flash Stage already has a viewport owner");
        if (!initialViewport || typeof initialViewport !== "object")
            throw new TypeError("Flash Stage initial viewport must be an object");

        // Snapshot each potentially hostile getter exactly once, then validate
        // the pair without publishing either half.
        const width = initialViewport.width;
        const height = initialViewport.height;
        const nextWidth = requireViewportDimension(width, "width");
        const nextHeight = requireViewportDimension(height, "height");

        // A getter may destroy/replace the Stage or install a competing owner.
        // Re-authenticate all authority after the last caller-controlled read.
        this._requireCurrent(stage);
        if (STAGE_VIEWPORT_OWNERS.has(stage as object))
            throw new Error("Flash Stage already has a viewport owner");

        const owner = new EngineFlashStageViewportOwner(stage, nextWidth, nextHeight);
        STAGE_VIEWPORT_OWNERS.set(stage as object, owner);
        return owner;
    }

    static configure(stage: LayaStage, options: FlashStageBootstrapOptions): FlashStageBootstrap {
        this._requireCurrent(stage);
        if (!options || typeof options !== "object")
            throw new TypeError("Flash Stage bootstrap options are required");
        if (options.align !== "TL" || options.scaleMode !== "noScale"
            || (options.quality !== "high" && options.quality !== "best")
            || options.showDefaultContextMenu !== false)
            throw new TypeError("Flash Stage bootstrap supports only TL/noScale/high-or-best/context-menu-disabled");
        const parameters = this._requireParameters(options.loaderParameters);
        const previous = STAGE_BOOTSTRAPS.get(stage as object);
        if (previous && !this._sameParameters(previous.loaderParameters, parameters))
            throw new Error("Flash Stage LoaderInfo parameters are immutable after bootstrap");

        // Retained source requests Flash HIGH; Laya's initialized renderer is the
        // high-quality path, so no native throttle/quality property is overwritten.
        stage.alignH = "left";
        stage.alignV = "top";
        stage.scaleMode = "noscale";
        const canvas = Browser.mainCanvas?.source;
        if (!canvas) throw new Error("Laya main canvas is unavailable for Stage context-menu policy");
        canvas.oncontextmenu = () => false;

        if (previous && previous.quality === options.quality) return previous;
        const bootstrap = Object.freeze({
            align: "TL" as const,
            scaleMode: "noScale" as const,
            quality: options.quality,
            showDefaultContextMenu: false as const,
            loaderParameters: parameters
        });
        STAGE_BOOTSTRAPS.set(stage as object, bootstrap);
        return bootstrap;
    }

    static getBootstrap(stage: LayaStage): FlashStageBootstrap {
        this._requireCurrent(stage);
        const bootstrap = STAGE_BOOTSTRAPS.get(stage as object);
        if (!bootstrap) throw new Error("Flash Stage bootstrap has not been configured");
        return bootstrap;
    }

    static addEventListener(stage: LayaStage, type: string, listener: FlashEventListener,
        useCapture = false, priority = 0, useWeakReference = false): void {
        this._router(stage).addEventListener(type, listener, useCapture, priority, useWeakReference);
    }

    static removeEventListener(stage: LayaStage, type: string, listener: FlashEventListener,
        useCapture = false): void {
        const router = STAGE_ROUTERS.get(this._requireCurrent(stage) as object);
        router?.removeEventListener(type, listener, useCapture);
    }

    static dispatchEvent(stage: LayaStage, event: Event): boolean {
        return this._router(stage).dispatchEvent(event, stage);
    }

    /** @internal Binds the unforgeable public Stage identity to its native producer. */
    static registerStageView(stage: LayaStage, view: Stage): void {
        this._requireCurrent(stage);
        if (!isFlashStage(view) || Stage.fromNative(stage) !== view)
            throw new TypeError("Flash Stage event target requires the canonical Stage view");
        const existing = STAGE_EVENT_TARGETS.get(stage as object);
        if (existing && existing !== view)
            throw new Error("The live Laya Stage already has a different public event target");
        STAGE_EVENT_TARGETS.set(stage as object, view);
    }

    static hasEventListener(stage: LayaStage, type: string): boolean {
        const router = STAGE_ROUTERS.get(this._requireCurrent(stage) as object);
        return router?.hasEventListener(type) ?? false;
    }

    static dispose(stage: LayaStage): void {
        this._requireCurrent(stage);
        const router = STAGE_ROUTERS.get(stage as object);
        if (!router) return;
        router.dispose();
        STAGE_ROUTERS.delete(stage as object);
    }

    private static _router(stage: LayaStage): FlashEventRouter {
        this._requireCurrent(stage);
        let router = STAGE_ROUTERS.get(stage as object);
        if (!router) {
            const existing = FlashEventRouter.forHost(stage);
            router = existing ?? new FlashEventRouter(stage,
                target => target === stage ? STAGE_EVENT_TARGETS.get(stage as object) ?? stage : target);
            if (existing)
                throw new Error("The native Stage already has a non-boundary Flash event owner");
            STAGE_ROUTERS.set(stage as object, router);
        }
        return router;
    }

    private static _requireCurrent(stage: LayaStage): LayaStage {
        return requireCurrentStage(stage);
    }

    private static _viewportRecord(stage: LayaStage): FlashStageViewportRecord {
        const owner = STAGE_VIEWPORT_OWNERS.get(stage as object);
        if (!owner) throw new Error("Flash Stage viewport has not been claimed");
        const record = VIEWPORT_OWNER_RECORDS.get(owner as object);
        if (!record || record.stage !== stage)
            throw new Error("Flash Stage viewport authority is unavailable");
        return record;
    }

    private static _requireParameters(value: FlashStageLoaderParameters): FlashStageLoaderParameters {
        if (!value || typeof value !== "object" || !LOADER_PARAMETER_VALUES.has(value))
            throw new TypeError("Flash LoaderInfo parameters require the authenticated search parser result");
        return value;
    }

    private static _sameParameters(left: Readonly<Record<string, string>>,
        right: Readonly<Record<string, string>>): boolean {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        return leftKeys.length === rightKeys.length
            && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
    }
}
