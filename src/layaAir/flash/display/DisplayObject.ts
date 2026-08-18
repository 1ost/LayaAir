import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { Point as LayaPoint } from "../../laya/maths/Point";
import { isFlashPoint, Point } from "../geom/Point";
import { FlashEventListener, FlashEventRouter } from "../events/FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";

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
}
