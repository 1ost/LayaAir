import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { Point as LayaPoint } from "../../laya/maths/Point";
import { isFlashPoint, Point } from "../geom/Point";
import { FlashEventListener, FlashEventRouter } from "../events/FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";
import { BitmapFilter } from "../filters/BitmapFilter";
import { isBitmapFilter } from "../filters/FilterRegistry";

const DISPLAY_EVENTS = new WeakMap<DisplayObject, FlashEventRouter>();
const DISPLAY_OBJECT_VALUES = new WeakSet<object>();

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
export class DisplayObject extends LayaSprite implements IEventDispatcher {
    constructor() {
        super();
        DISPLAY_OBJECT_VALUES.add(this);
    }

    /** Flash returns detached arrays containing detached filter values. */
    override get filters(): BitmapFilter[] {
        const values = super.filters;
        if (!values) return [];
        const detached: BitmapFilter[] = [];
        for (let index = 0; index < values.length; index++) {
            const value = values[index];
            if (!isBitmapFilter(value)) throw new TypeError("Flash DisplayObject contains a non-Flash filter");
            detached.push(value.clone());
        }
        return detached;
    }
    override set filters(value: BitmapFilter[] | null) {
        if (value == null) {
            super.filters = null;
            return;
        }
        if (!Array.isArray(value)) throw new TypeError("DisplayObject.filters must be an Array");
        const detached: BitmapFilter[] = [];
        for (let index = 0; index < value.length; index++) {
            const filter = value[index];
            if (!isBitmapFilter(filter)) throw new TypeError(`DisplayObject.filters[${index}] must be a concrete native BitmapFilter`);
            detached.push(filter.clone());
        }
        super.filters = detached;
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
    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        events(this).addEventListener(type, listener, useCapture, priority, useWeakReference);
    }
    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        events(this).removeEventListener(type, listener, useCapture);
    }
    dispatchEvent(event: Event): boolean { return events(this).dispatchEvent(event, this); }
    hasEventListener(type: string): boolean { return events(this).hasEventListener(type); }
    willTrigger(type: string): boolean {
        let node: LayaSprite | null = this;
        while (node) {
            if (FlashEventRouter.forHost(node)?.hasEventListener(type)) return true;
            node = node.parent as LayaSprite | null;
        }
        return false;
    }
    get root(): DisplayObject {
        let value: DisplayObject = this;
        while (value.parent instanceof DisplayObject) value = value.parent;
        return value;
    }

    override destroy(destroyChild = true): void {
        const router = DISPLAY_EVENTS.get(this);
        if (router) {
            router.dispose();
            DISPLAY_EVENTS.delete(this);
        }
        super.destroy(destroyChild);
    }
}
