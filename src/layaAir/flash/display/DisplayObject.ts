import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { runAdmittedNodeMutation } from "../../laya/display/NodeMutationTransaction";
import { Point as LayaPoint } from "../../laya/maths/Point";
import { isFlashPoint, Point } from "../geom/Point";
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

/**
 * Internal type-only adapter: Laya owns the native matrix while the exported
 * Flash subclass exposes an unrelated source-shaped Transform facade.
 */
class NativeDisplayObjectHost extends LayaSprite {
    override get transform(): any { return super.transform; }
    override set transform(value: any) { super.transform = value; }
}

const DISPLAY_EVENTS = new WeakMap<DisplayObject, FlashEventRouter>();
const DISPLAY_OBJECT_VALUES = new WeakSet<object>();
const destroyCanonicalDisplayObject = LayaSprite.prototype.destroy;

/** @internal Read-only nominal proof for the canonical Flash display base. */
export function isFlashDisplayObject(value: unknown): value is DisplayObject {
    return typeof value === "object" && value !== null && DISPLAY_OBJECT_VALUES.has(value);
}
function events(value: DisplayObject): FlashEventRouter {
    let router = DISPLAY_EVENTS.get(value);
    if (!router) DISPLAY_EVENTS.set(value, router = new FlashEventRouter(value));
    return router;
}

/** Flash display source shape backed by a real Laya Sprite. */
export class DisplayObject extends NativeDisplayObjectHost implements IEventDispatcher {
    constructor() {
        super();
        DISPLAY_OBJECT_VALUES.add(this);
    }

    override get alpha(): number { return super.alpha; }
    override set alpha(value: number) {
        const clamped = Math.max(0, Math.min(1, Number(value)));
        super.alpha = Math.trunc(clamped * 256) / 256;
        if (DISPLAY_OBJECT_VALUES.has(this)) synchronizeDisplayObjectAlpha(this);
    }

    /** Flash facade backed by the Sprite's native Laya transform state. */
    override get transform(): Transform { return transformForDisplayObject(this); }
    override set transform(value: Transform) { applyTransformToDisplayObject(this, value); }

    /** Flash returns detached arrays containing detached filter values. */
    override get filters(): BitmapFilter[] { return getDisplayObjectFilters(this); }
    override set filters(value: BitmapFilter[] | null) { setDisplayObjectFilters(this, value); }
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

    override destroy(destroyChild = true): void {
        runAdmittedNodeMutation(this, "destroyFlashDisplayObject", () => {
            const router = DISPLAY_EVENTS.get(this);
            if (router) {
                router.dispose();
                DISPLAY_EVENTS.delete(this);
            }
            destroyCanonicalDisplayObject.call(this, destroyChild);
        });
    }
}
