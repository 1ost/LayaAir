import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { runAdmittedNodeMutation } from "../../laya/display/NodeMutationTransaction";
import { Point as LayaPoint } from "../../laya/maths/Point";
import { Rectangle as LayaRectangle } from "../../laya/maths/Rectangle";
import {
    AccessibilityProperties, isFlashAccessibilityProperties
} from "../accessibility/AccessibilityProperties";
import { isFlashPoint, Point } from "../geom/Point";
import { isFlashRectangle, Rectangle } from "../geom/Rectangle";
import { FlashEventListener, FlashEventRouter } from "../events/FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";
import { BitmapFilter } from "../filters/BitmapFilter";
import {
    applyTransformToDisplayObject,
    getDisplayObjectFilters,
    setDisplayObjectFilters,
    synchronizeDisplayObjectAlpha,
    Transform,
    transformForDisplayObject,
} from "../geom/Transform";
import type { LoaderInfo } from "./Loader";

/**
 * Internal type-only adapter: Laya owns the native matrix while the exported
 * Flash subclass exposes an unrelated source-shaped Transform facade.
 */
class NativeDisplayObjectHost extends LayaSprite {
    override get transform(): any { return super.transform; }
    override set transform(value: any) { super.transform = value; }
    override getBounds(out?: any): any { return super.getBounds(out); }
}

const DISPLAY_EVENTS = new WeakMap<DisplayObject, FlashEventRouter>();
const DISPLAY_OBJECT_VALUES = new WeakSet<object>();
const DISPLAY_LOADER_INFOS = new WeakMap<DisplayObject, LoaderInfo>();
const destroyCanonicalDisplayObject = LayaSprite.prototype.destroy;

export type DisplayObjectLoaderInfo = LoaderInfo;

/** @internal Read-only nominal proof for the canonical Flash display base. */
export function isFlashDisplayObject(value: unknown): value is DisplayObject {
    return typeof value === "object" && value !== null && DISPLAY_OBJECT_VALUES.has(value);
}

/** @internal Associates one authenticated Loader content root with its LoaderInfo. */
export function bindDisplayObjectLoaderInfo(value: DisplayObject, info: LoaderInfo): void {
    if (!isFlashDisplayObject(value)) throw new TypeError("LoaderInfo content must be a canonical DisplayObject");
    const current = DISPLAY_LOADER_INFOS.get(value);
    if (current && current !== info) throw new Error("DisplayObject already belongs to another LoaderInfo");
    DISPLAY_LOADER_INFOS.set(value, info);
}

/** @internal Releases only the exact LoaderInfo association that was published. */
export function unbindDisplayObjectLoaderInfo(value: DisplayObject, info: LoaderInfo): void {
    if (DISPLAY_LOADER_INFOS.get(value) === info) DISPLAY_LOADER_INFOS.delete(value);
}

function events(value: DisplayObject): FlashEventRouter {
    let router = DISPLAY_EVENTS.get(value);
    if (!router) DISPLAY_EVENTS.set(value, router = new FlashEventRouter(value));
    return router;
}

/** Flash display source shape backed by a real Laya Sprite. */
export class DisplayObject extends NativeDisplayObjectHost implements IEventDispatcher {
    private _accessibilityProperties: AccessibilityProperties | null = null;
    private _opaqueBackground: unknown = null;
    private _scale9Grid: Rectangle | null = null;

    constructor() {
        super();
        // Native Laya leaves the redirected-parent slot absent until first attachment;
        // Flash requires an unattached DisplayObject to expose an explicit null parent.
        this._$parent = null;
        DISPLAY_OBJECT_VALUES.add(this);
    }

    /** Flash reports transformed content bounds when no explicit size was assigned. */
    override get width(): number {
        return this._isWidthSet ? super.width : this._flashBoundsSize().width;
    }
    override set width(value: number) { super.width = value; }

    /** Flash height follows the same child-bound contract as width. */
    override get height(): number {
        return this._isHeightSet ? super.height : this._flashBoundsSize().height;
    }
    override set height(value: number) { super.height = value; }

    private _flashBoundsSize(): { width: number; height: number } {
        const bounds = super.getSelfBounds();
        const left = bounds.x;
        const top = bounds.y;
        const right = left + bounds.width;
        const bottom = top + bounds.height;
        const point = new LayaPoint();
        let minimumX = Number.POSITIVE_INFINITY;
        let minimumY = Number.POSITIVE_INFINITY;
        let maximumX = Number.NEGATIVE_INFINITY;
        let maximumY = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < 4; index++) {
            point.setTo(index === 0 || index === 3 ? left : right, index < 2 ? top : bottom);
            this.toParentPoint(point);
            minimumX = Math.min(minimumX, point.x);
            minimumY = Math.min(minimumY, point.y);
            maximumX = Math.max(maximumX, point.x);
            maximumY = Math.max(maximumY, point.y);
        }
        return { width: maximumX - minimumX, height: maximumY - minimumY };
    }

    override get alpha(): number { return super.alpha; }
    override set alpha(value: number) {
        const clamped = Math.max(0, Math.min(1, Number(value)));
        super.alpha = Math.trunc(clamped * 256) / 256;
        if (DISPLAY_OBJECT_VALUES.has(this)) synchronizeDisplayObjectAlpha(this);
    }

    /** Flash boolean facade over Laya's canonical bitmap cache mode. */
    get cacheAsBitmap(): boolean { return super.cacheAs === "bitmap"; }
    set cacheAsBitmap(value: boolean) { super.cacheAs = value ? "bitmap" : "none"; }

    /** Retained Flash cache optimization hint. Rendering remains Laya-owned. */
    get opaqueBackground(): unknown { return this._opaqueBackground; }
    set opaqueBackground(value: unknown) { this._opaqueBackground = value; }

    /** Retained nine-slice contract; authored renderers consume the detached grid. */
    get scale9Grid(): Rectangle | null { return this._scale9Grid?.clone() ?? null; }
    set scale9Grid(value: Rectangle | null) {
        if (value !== null && !isFlashRectangle(value))
            throw new TypeError("DisplayObject.scale9Grid requires a Rectangle or null");
        this._scale9Grid = value?.clone() ?? null;
        this.repaint();
    }

    /** Flash facade backed by the Sprite's native Laya transform state. */
    override get transform(): Transform { return transformForDisplayObject(this); }
    override set transform(value: Transform) { applyTransformToDisplayObject(this, value); }

    /** Flash returns detached arrays containing detached filter values. */
    override get filters(): BitmapFilter[] { return getDisplayObjectFilters(this); }
    override set filters(value: BitmapFilter[] | null) { setDisplayObjectFilters(this, value); }
    get accessibilityProperties(): AccessibilityProperties | null { return this._accessibilityProperties; }
    set accessibilityProperties(value: AccessibilityProperties | null) {
        if (value !== null && !isFlashAccessibilityProperties(value))
            throw new TypeError("DisplayObject.accessibilityProperties requires AccessibilityProperties or null");
        this._accessibilityProperties = value;
    }
    globalToLocal(point: Point): Point;
    globalToLocal(point: LayaPoint, createNewPoint?: boolean, globalNode?: LayaSprite): LayaPoint;
    globalToLocal(point: Point | LayaPoint, createNewPoint = false, globalNode?: LayaSprite): Point | LayaPoint {
        if (isFlashPoint(point)) {
            const value = super.globalToLocal(new LayaPoint(point.x, point.y), true, globalNode);
            return new Point(value.x, value.y);
        }
        if (!(point instanceof LayaPoint)) throw new TypeError("point must be a Point");
        return super.globalToLocal(point, createNewPoint, globalNode);
    }
    localToGlobal(point: Point): Point;
    localToGlobal(point: LayaPoint, createNewPoint?: boolean, globalNode?: LayaSprite): LayaPoint;
    localToGlobal(point: Point | LayaPoint, createNewPoint = false, globalNode?: LayaSprite): Point | LayaPoint {
        if (isFlashPoint(point)) {
            const value = super.localToGlobal(new LayaPoint(point.x, point.y), true, globalNode);
            return new Point(value.x, value.y);
        }
        if (!(point instanceof LayaPoint)) throw new TypeError("point must be a Point");
        return super.localToGlobal(point, createNewPoint, globalNode);
    }

    getBounds(targetCoordinateSpace: DisplayObject): Rectangle;
    override getBounds(out?: LayaRectangle): LayaRectangle;
    override getBounds(value?: DisplayObject | LayaRectangle): Rectangle | LayaRectangle {
        if (value === undefined || value instanceof LayaRectangle) return super.getBounds(value);
        return this._boundsIn(value);
    }

    getRect(targetCoordinateSpace: DisplayObject): Rectangle {
        return this._boundsIn(targetCoordinateSpace);
    }

    get loaderInfo(): DisplayObjectLoaderInfo | null {
        let value: DisplayObject | null = this;
        while (value) {
            const loaderInfo = DISPLAY_LOADER_INFOS.get(value);
            if (loaderInfo) return loaderInfo;
            const parent: unknown = value.parent;
            value = isFlashDisplayObject(parent) ? parent : null;
        }
        return null;
    }

    hitTestObject(value: DisplayObject): boolean {
        if (!isFlashDisplayObject(value)) throw new TypeError("hitTestObject requires a DisplayObject");
        return this._globalBounds().intersects(value._globalBounds());
    }

    override hitTestPoint(x: number, y: number, shapeFlag = false): boolean {
        const globalX = Number(x);
        const globalY = Number(y);
        if (!shapeFlag) return this._globalBounds().contains(globalX, globalY);
        return super.hitTestPoint(globalX, globalY);
    }
    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        events(this).addEventListener(type, listener, useCapture, priority, useWeakReference);
    }
    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        events(this).removeEventListener(type, listener, useCapture);
    }
    dispatchEvent(event: Event): boolean { return events(this).dispatchEvent(event, this); }
    hasEventListener(type: string): boolean { return events(this).hasEventListener(type); }
    willTrigger(type: string): boolean {
        let node: unknown = this;
        while (typeof node === "object" && node !== null) {
            if (FlashEventRouter.forHost(node as unknown as LayaSprite)?.hasEventListener(type)) return true;
            node = (node as { parent?: unknown }).parent ?? null;
        }
        return false;
    }
    get root(): DisplayObject {
        let value: DisplayObject = this;
        for (;;) {
            const parent: unknown = value.parent;
            if (!isFlashDisplayObject(parent)) break;
            value = parent;
        }
        return value;
    }

    private _boundsIn(targetCoordinateSpace: DisplayObject): Rectangle {
        if (!isFlashDisplayObject(targetCoordinateSpace))
            throw new TypeError("targetCoordinateSpace must be a DisplayObject");
        const local = super.getSelfBounds(undefined, true);
        const corners = [
            new LayaPoint(local.x, local.y),
            new LayaPoint(local.x + local.width, local.y),
            new LayaPoint(local.x + local.width, local.y + local.height),
            new LayaPoint(local.x, local.y + local.height),
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const corner of corners) {
            const global = super.localToGlobal(corner, true);
            const point = targetCoordinateSpace === this
                ? corner
                : targetCoordinateSpace.globalToLocal(global, true) as LayaPoint;
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY)
            || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return new Rectangle();
        return new Rectangle(minX, minY, maxX - minX, maxY - minY);
    }

    private _globalBounds(): Rectangle {
        const local = super.getSelfBounds(undefined, true);
        const corners = [
            new LayaPoint(local.x, local.y),
            new LayaPoint(local.x + local.width, local.y),
            new LayaPoint(local.x + local.width, local.y + local.height),
            new LayaPoint(local.x, local.y + local.height),
        ].map(point => super.localToGlobal(point, true));
        const xs = corners.map(point => point.x);
        const ys = corners.map(point => point.y);
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const maxX = Math.max(...xs), maxY = Math.max(...ys);
        return new Rectangle(minX, minY, maxX - minX, maxY - minY);
    }

    override destroy(destroyChild = true): void {
        runAdmittedNodeMutation(this, "destroyFlashDisplayObject", () => {
            this._accessibilityProperties = null;
            this._opaqueBackground = null;
            this._scale9Grid = null;
            DISPLAY_LOADER_INFOS.delete(this);
            const router = DISPLAY_EVENTS.get(this);
            if (router) {
                router.dispose();
                DISPLAY_EVENTS.delete(this);
            }
            destroyCanonicalDisplayObject.call(this, destroyChild);
        });
    }
}
